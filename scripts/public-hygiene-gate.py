#!/usr/bin/env python3
"""Public-hygiene gate. Pre-publish check of candidate files, history, and runtime.

Usage:
    python3 scripts/public-hygiene-gate.py \
        --repo-root PATH \
        [--panel-dist-dir PATH] \
        [--runtime-url URL --auth-token TOKEN]

Writes evidence/<UTC>/public-hygiene-report.json (0600).
Exits non-zero on fatal hits, scan errors, or incomplete/skipped gates. Ignored
untracked files are outside the candidate set; force-added files must be rerun.
History is limited to HEAD-reachable commits (not other refs or reflogs), at most
200,000 changes, 8 MiB per text blob and 512 MiB total; limits fail closed.
Binary extensions and NUL-sniffed blobs are not content-scanned. Gate sources and
fixtures are excluded. Historical content accepts only object/path/content-bound
exceptions, never legacy current-file allowlists. Explicit private inputs stay
outside the publication tree; bundle exceptions require exact match offsets.

The raw matched substring is NEVER written to the report or stdout -- a hit
records only its pattern name, path, and line, with a redacted context marker.
That keeps the report safe to paste even when it catches a credential.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

SCRIPTS_DIR = Path(__file__).resolve().parent
REPO_ROOT_DEFAULT = SCRIPTS_DIR.parent
ALLOWLIST_DEFAULT = SCRIPTS_DIR / "hygiene_allowlist.json"

# Content check is skipped for these; the filename check still runs via Gate 3.
_BINARY_EXT = {
    ".png", ".jpg", ".jpeg", ".gif", ".ico", ".webp", ".bmp",
    ".woff", ".woff2", ".ttf", ".eot", ".otf", ".pdf", ".zip", ".gz",
    ".tgz", ".bz2", ".xz", ".7z", ".pyc", ".so", ".dylib", ".dll",
    ".bin", ".wasm", ".node", ".class", ".jar", ".mp3", ".mp4", ".mov",
    ".wav", ".ogg", ".webm", ".avif",
}


@dataclass
class Hit:
    surface: str
    path: str
    pattern: str
    line: int = 0
    offset_in_line: int = 0
    redacted_context: str = ""
    severity: str = "fatal"


@dataclass
class GateResult:
    status: str = "pass"  # pass | fail | skipped
    reason: str = ""
    scanned: int = 0
    hits: list[Hit] = field(default_factory=list)

    def finalize(self) -> "GateResult":
        if self.status in ("skipped", "fail"):
            return self
        self.status = "fail" if any(h.severity == "fatal" for h in self.hits) else "pass"
        return self


@dataclass
class Report:
    timestamp: str
    gates: dict[str, GateResult] = field(default_factory=dict)
    private_loaded: bool = False

    @property
    def overall(self) -> str:
        if any(g.status == "fail" for g in self.gates.values()):
            return "fail"
        if any(g.status == "skipped" for g in self.gates.values()):
            return "incomplete"
        return "pass"

    def to_json(self) -> str:
        payload = {
            "timestamp": self.timestamp,
            "generated_by": "scripts/public-hygiene-gate.py",
            "operator_private_patterns_loaded": self.private_loaded,
            "gates": {
                name: {
                    "status": g.status,
                    "reason": g.reason,
                    "scanned": g.scanned,
                    "hits": [asdict(h) for h in g.hits],
                }
                for name, g in self.gates.items()
            },
            "overall": self.overall,
        }
        return json.dumps(payload, indent=2)

    def human_summary(self) -> str:
        private = "loaded" if self.private_loaded else "NOT loaded (operator identifiers are NOT checked)"
        lines = [f"public-hygiene-gate @ {self.timestamp}", f"  operator-private patterns: {private}", ""]
        for name, g in self.gates.items():
            lines.append(f"  {name}: {g.status} (scanned={g.scanned}, hits={len(g.hits)})")
            if g.reason:
                lines.append(f"    reason: {g.reason}")
            # group by pattern for a compact summary
            by_pat: dict[str, int] = {}
            for h in g.hits:
                by_pat[h.pattern] = by_pat.get(h.pattern, 0) + 1
            for pat, n in sorted(by_pat.items(), key=lambda kv: -kv[1]):
                lines.append(f"      {pat}: {n}")
            for h in g.hits[:10]:
                lines.append(f"      - {h.pattern} at {h.path}:{h.line}")
            if len(g.hits) > 10:
                lines.append(f"      ... and {len(g.hits) - 10} more hits")
        lines.append("")
        lines.append(f"OVERALL: {self.overall}")
        return "\n".join(lines)


def utc_timestamp() -> str:
    return time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())


def load_patterns(private_path: Path | None = None) -> Any:
    """Load the hygiene_patterns module (PATTERNS + INTERNAL_DOC_PATHS)."""
    import importlib.util

    spec_path = SCRIPTS_DIR / "hygiene_patterns.py"
    spec = importlib.util.spec_from_file_location("hygiene_patterns", spec_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {spec_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    # Operator-specific patterns live in an UNTRACKED sibling file so this tracked catalog never has to
    # contain them. Absent on a fresh clone or in CI: the public catalog still runs and the report says
    # that operator identifiers were NOT checked. HYGIENE_SKIP_PRIVATE=1 forces public-only mode.
    module.PRIVATE_LOADED = False
    explicit = private_path is not None
    private_path = private_path or SCRIPTS_DIR / "hygiene_private.py"
    if explicit and (not private_path.is_file() or os.environ.get("HYGIENE_SKIP_PRIVATE")):
        raise ValueError("explicit private catalog unavailable")
    if private_path.is_file() and not os.environ.get("HYGIENE_SKIP_PRIVATE"):
        pspec = importlib.util.spec_from_file_location("hygiene_private", private_path)
        if pspec is not None and pspec.loader is not None:
            sys.path.insert(0, str(SCRIPTS_DIR))  # lets the private file `from hygiene_patterns import _p`
            pmod = importlib.util.module_from_spec(pspec)
            pspec.loader.exec_module(pmod)
            module.PATTERNS = list(module.PATTERNS) + list(pmod.PRIVATE_PATTERNS)
            module.PRIVATE_LOADED = True
    return module


def compile_patterns(patterns: list[Any]) -> list[tuple[Any, Any]]:
    out = []
    for p in patterns:
        out.append((p, re.compile(p.regex)))
    return out


# --------------------------------------------------------------------------- #
# Allowlist: a JSON list of {pattern, file, section?, lines?}.
#   - section: allow matches inside the "## <section>" heading block
#   - lines:   [start, end] 1-indexed inclusive
#   - neither: whole file
# --------------------------------------------------------------------------- #
def load_allowlist(path: Path, known_patterns: set[str]) -> list[dict]:
    if not path.is_file():
        return []
    entries = json.loads(path.read_text(encoding="utf-8"))
    for e in entries:
        if "sha256" in e:
            _validate_bound_entries([e], known_patterns)
        if e.get("pattern") not in known_patterns:
            raise ValueError(f"allowlist references unknown pattern: {e.get('pattern')}")
        if e.get("file", "").startswith("/"):
            raise ValueError(f"allowlist file must be repo-relative: {e['file']}")
        rng = e.get("lines")
        if rng and rng[0] > rng[1]:
            raise ValueError(f"allowlist bad line range: {rng}")
    return entries


def load_bound_allowlist(path: Path, known_patterns: set[str]) -> list[dict]:
    if not path.is_file():
        raise ValueError("explicit exception file unavailable")
    entries = json.loads(path.read_text(encoding="utf-8"))
    return _validate_bound_entries(entries, known_patterns)


def _validate_bound_entries(entries, known_patterns):
    if not isinstance(entries, list):
        raise ValueError("exceptions must be a list")
    required = {"pattern", "file", "surface", "sha256", "lines", "reason"}
    for e in entries:
        if not isinstance(e, dict) or set(e) != (required | ({"blob"} if e.get("surface") == "historical_file" else {"offsets"} if e.get("surface") == "panel_bundle" else set())):
            raise ValueError("bound exception fields invalid")
        if e["pattern"] not in known_patterns:
            raise ValueError("unknown exception pattern")
        f = e["file"]
        if not isinstance(f, str) or not f or f.startswith("/") or any(c in f for c in "*?[]\\") or ".." in f.split("/"):
            raise ValueError("exception requires literal relative path")
        if e["surface"] not in {"tracked_file", "historical_file", "panel_bundle"}:
            raise ValueError("unsupported exception surface")
        if e["surface"] == "historical_file" and not re.fullmatch(r"(?:[0-9a-f]{40}|[0-9a-f]{64})", str(e["blob"])):
            raise ValueError("historical exception requires full object ID")
        if not isinstance(e["sha256"], str) or not re.fullmatch(r"[0-9a-f]{64}", e["sha256"]):
            raise ValueError("exception requires SHA-256")
        rng = e["lines"]
        if not isinstance(rng, list) or len(rng) != 2 or any(type(n) is not int for n in rng) or not 1 <= rng[0] <= rng[1]:
            raise ValueError("exception requires bounded lines")
        if e["surface"] == "panel_bundle":
            offsets = e["offsets"]
            if not isinstance(offsets, list) or len(offsets) != 2 or any(type(n) is not int for n in offsets) or not 0 <= offsets[0] < offsets[1]:
                raise ValueError("bundle requires exact character offsets")
        if not isinstance(e["reason"], str) or not e["reason"].strip():
            raise ValueError("exception requires review reason")
    return entries


def _section_span(text: str, section: str) -> tuple[int, int] | None:
    """1-indexed [start,end] line span of a markdown '## <section>' block."""
    lines = text.splitlines()
    start = None
    for i, ln in enumerate(lines):
        if start is None:
            if re.match(rf"^#{{1,6}}\s+{re.escape(section)}\s*$", ln):
                start = i + 1
        elif re.match(r"^#{1,6}\s+", ln):
            return (start, i)  # up to the line before the next heading
    if start is not None:
        return (start, len(lines))
    return None


def _is_allowlisted(allowlist, pattern, path, line, text, surface="tracked_file", blob=None, end_line=None, offsets=None) -> bool:
    for e in allowlist:
        if e["pattern"] != pattern or e["file"] != path:
            continue
        if "sha256" in e:
            if (e["surface"] == surface and e.get("blob") == blob
                    and (surface != "panel_bundle" or e["offsets"] == offsets)
                    and hashlib.sha256(text.encode("utf-8")).hexdigest() == e["sha256"]
                    and e["lines"][0] <= line <= (end_line or line) <= e["lines"][1]):
                return True
        elif surface == "historical_file":
            continue
        elif "section" in e:
            span = _section_span(text, e["section"])
            if span and span[0] <= line <= span[1]:
                return True
        elif "lines" in e:
            if e["lines"][0] <= line <= e["lines"][1]:
                return True
        else:
            return True  # whole-file allowlist
    return False


def _scan_text(text, path, surface, compiled, allowlist, *, exception_path=None, blob=None) -> list[Hit]:
    hits: list[Hit] = []
    safe_path = None
    for pdef, rx in compiled:
        if surface not in pdef.surfaces:
            continue
        for m in rx.finditer(text):
            line = text.count("\n", 0, m.start()) + 1
            end_line = text.count("\n", 0, max(m.start(), m.end() - 1)) + 1
            if _is_allowlisted(allowlist, pdef.name, exception_path or path, line, text,
                               "historical_file" if blob else surface, blob, end_line, [m.start(), m.end()]):
                continue
            if safe_path is None:
                safe_path = _redact_path(path, compiled)
            hits.append(Hit(
                surface=surface,
                path=safe_path,
                pattern=pdef.name,
                line=line,
                redacted_context=f"[REDACTED-{pdef.name}]",
                severity=pdef.severity,
            ))
    return hits


def _redact_path(path, compiled):
    for _, rx in compiled:
        path = rx.sub("[REDACTED]", path)
    return path


def _read_text(fp: Path) -> str | None:
    if fp.suffix.lower() in _BINARY_EXT:
        return None
    raw = fp.read_bytes()
    if b"\x00" in raw[:1024]:  # binary sniff
        return None
    return raw.decode("utf-8", errors="replace")


def _git(repo_root: Path, args: list[str]) -> str | None:
    try:
        proc = subprocess.run(
            ["git", "-C", str(repo_root), *args],
            capture_output=True, text=True,
        )
    except FileNotFoundError:
        return None
    if proc.returncode != 0:
        return None
    return proc.stdout


def _git_toplevel(repo_root: Path) -> Path | None:
    out = _git(repo_root, ["rev-parse", "--show-toplevel"])
    if out is None:
        return None
    return Path(out.strip()).resolve()


# The gate's own sources and test fixtures intentionally contain the very strings it detects (a pattern
# file spells out what it forbids; the "dirty" fixtures exist to be flagged). Without this exemption a
# tracked gate would fail on itself. These paths are repo-relative, so fixture roots passed via
# --repo-root (which are separate roots) are unaffected.
_SELF_EXEMPT_PREFIXES = ("tests/fixtures/hygiene/",)
_SELF_EXEMPT_FILES = {
    "scripts/public-hygiene-gate.py",
    "scripts/hygiene_patterns.py",
    "scripts/hygiene_allowlist.json",
    "tests/test_public_hygiene_gate.py",
}


def _drop_self_exempt(paths: list[str]) -> list[str]:
    return [
        p for p in paths
        if p not in _SELF_EXEMPT_FILES and not p.startswith(_SELF_EXEMPT_PREFIXES)
    ]


def _list_files(repo_root: Path) -> list[str]:
    """Tracked and non-ignored untracked candidate paths, without following symlinks."""
    if not repo_root.is_dir():
        raise ValueError("repo root is not a directory")
    is_root = _git_toplevel(repo_root) == repo_root.resolve()
    if is_root:
        out = _git(repo_root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
        if out is None:
            raise RuntimeError("git ls-files failed")
        return _drop_self_exempt(sorted(set(filter(None, out.split("\0")))))
    # fallback: walk the tree
    files = []
    def walk_error(exc):
        raise exc

    for dirpath, dirnames, filenames in os.walk(repo_root, onerror=walk_error):
        dirnames[:] = [d for d in dirnames if d not in (".git", "node_modules")]
        for fn in filenames:
            rel = os.path.relpath(os.path.join(dirpath, fn), repo_root)
            files.append(rel.replace(os.sep, "/"))
    return _drop_self_exempt(files)


def gate_tracked_files(repo_root, compiled, allowlist) -> GateResult:
    result = GateResult()
    for rel in _list_files(repo_root):
        fp = repo_root / rel
        if fp.is_symlink():
            # A tracked symlink stores a path (often an absolute home path). Scan that text; never follow it.
            result.scanned += 1
            result.hits.extend(_scan_text(os.readlink(fp), rel, "tracked_file", compiled, allowlist))
            continue
        if not fp.is_file():
            continue
        text = _read_text(fp)
        if text is None:
            continue
        result.scanned += 1
        result.hits.extend(_scan_text(text, rel, "tracked_file", compiled, allowlist))
    if _git_toplevel(repo_root) == repo_root.resolve():
        proc = subprocess.run(["git", "-C", str(repo_root), "ls-files", "--stage", "-z"],
                              capture_output=True, check=True)
        for record in filter(None, proc.stdout.split(b"\0")):
            metadata, path_bytes = record.split(b"\t", 1)
            mode, oid, stage = metadata.split()
            if stage != b"0":
                raise ValueError("unmerged index cannot be cleared")
            rel = path_bytes.decode("utf-8", errors="surrogateescape")
            if not _drop_self_exempt([rel]) or Path(rel).suffix.lower() in _BINARY_EXT:
                continue
            if mode == b"160000":
                raise ValueError("submodule contents cannot be cleared")
            raw = subprocess.run(["git", "-C", str(repo_root), "cat-file", "blob", oid.decode("ascii")],
                                 capture_output=True, check=True).stdout
            if b"\0" not in raw[:1024]:
                result.scanned += 1
                result.hits.extend(_scan_text(raw.decode("utf-8", errors="replace"), rel,
                                              "tracked_file", compiled, allowlist))
    return result.finalize()


def gate_filenames(repo_root, compiled, internal_doc_paths, allowlist) -> GateResult:
    result = GateResult()
    doc_rx = [re.compile(r) for r in internal_doc_paths]
    for rel in _list_files(repo_root):
        result.scanned += 1
        for rx in doc_rx:
            if rx.search(rel):
                result.hits.append(Hit(
                    surface="filename", path=_redact_path(rel, compiled), pattern="P-INTERNAL-DOC",
                    line=0, redacted_context="[internal-doc tracked]",
                    severity="fatal",
                ))
        # apply content patterns to the path string itself
        result.hits.extend(_scan_text(rel, rel, "filename", compiled, allowlist))
    return result.finalize()


def gate_commit_history(repo_root, compiled, allowlist) -> GateResult:
    if _git_toplevel(repo_root) != repo_root.resolve():
        return GateResult(status="skipped", reason="not a git repo root")
    out = _git(repo_root, ["log", "--format=%H%n%an%n%ae%n%cn%n%ce%n%B%n---COMMIT-END---"])
    if out is None:
        return GateResult(status="skipped", reason="git log unavailable")
    result = GateResult()
    for block in out.split("---COMMIT-END---"):
        block = block.strip()
        if not block:
            continue
        result.scanned += 1
        sha, _, msg = block.partition("\n")
        result.hits.extend(_scan_text(msg, f"commit:{sha[:9]}", "commit_message", compiled, allowlist))
    return result.finalize()


def gate_historical_files(repo_root, compiled, internal_doc_paths, allowlist) -> GateResult:
    """Scan changed blobs and paths reachable from HEAD, with explicit resource ceilings."""
    if _git_toplevel(repo_root) != repo_root.resolve():
        return GateResult(status="skipped", reason="not a git repo root")
    shallow = _git(repo_root, ["rev-parse", "--is-shallow-repository"])
    if shallow is None or shallow.strip() != "false":
        return GateResult(status="fail", reason="full git history unavailable")
    # This streams raw NUL-delimited changes rather than materializing every historical tree.
    result = GateResult()
    seen = set()
    total_bytes = 0
    max_records, max_blob, max_total = 200_000, 8 * 1024 * 1024, 512 * 1024 * 1024
    doc_rx = [re.compile(r) for r in internal_doc_paths]
    log = subprocess.Popen(["git", "-C", str(repo_root), "log", "--raw", "-z", "--no-abbrev",
                            "--no-renames", "--root", "--diff-merges=first-parent", "--format=", "HEAD"],
                           stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    cat = subprocess.Popen(["git", "-C", str(repo_root), "cat-file", "--batch"],
                           stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    def tokens(stream):
        buf = b""
        while chunk := stream.read(65536):
            buf += chunk
            parts = buf.split(b"\0")
            yield from parts[:-1]
            buf = parts[-1]
            if len(buf) > 1024 * 1024:
                raise ValueError("git history record too large")
        if buf:
            raise ValueError("incomplete git history record")
    try:
        it = iter(tokens(log.stdout))
        for count, header in enumerate(it, 1):
            if count > max_records:
                raise ValueError("history record limit exceeded")
            fields = header.lstrip(b"\n").split()
            if len(fields) != 5 or not fields[0].startswith(b":"):
                raise ValueError("invalid git history record")
            path = next(it).decode("utf-8", errors="surrogateescape")
            if not _drop_self_exempt([path]):
                continue
            path_label = "history:path"
            if any(rx.search(path) for rx in doc_rx):
                result.hits.append(Hit(surface="filename", path=path_label, pattern="P-INTERNAL-DOC"))
            result.hits.extend(_scan_text(path, path_label, "filename", compiled, []))
            oid = fields[3].decode("ascii")
            if set(oid) == {"0"} or (oid, path) in seen:
                continue
            if Path(path).suffix.lower() in _BINARY_EXT:
                continue
            seen.add((oid, path))
            cat.stdin.write(oid.encode("ascii") + b"\n")
            cat.stdin.flush()
            meta = cat.stdout.readline().split()
            if len(meta) != 3 or meta[1] != b"blob":
                raise ValueError("historical object unavailable")
            size = int(meta[2])
            if size > max_blob or total_bytes + size > max_total:
                raise ValueError("history byte limit exceeded")
            raw = cat.stdout.read(size)
            if len(raw) != size or cat.stdout.read(1) != b"\n":
                raise ValueError("incomplete historical blob")
            total_bytes += size
            result.scanned += 1
            if b"\0" not in raw[:1024]:
                # Only object/path/content-bound historical exceptions apply here.
                result.hits.extend(_scan_text(raw.decode("utf-8", errors="replace"),
                                              f"history:blob:{oid[:12]}", "tracked_file", compiled, allowlist,
                                              exception_path=path, blob=oid))
        if log.wait() != 0:
            raise ValueError("git history unavailable")
    except (OSError, ValueError, StopIteration):
        result.status = "fail"
        result.reason = "historical scan incomplete (git error or resource limit)"
    finally:
        log.kill() if log.poll() is None else None
        cat.kill() if cat.poll() is None else None
        log.wait()
        cat.wait()
        for stream in (log.stdout, cat.stdin, cat.stdout):
            if stream:
                stream.close()
    return result.finalize()


def gate_panel_bundle(dist_dir, compiled, allowlist) -> GateResult:
    if dist_dir is None:
        return GateResult(status="skipped", reason="no panel dist directory supplied")
    if not dist_dir.is_dir():
        return GateResult(status="fail", reason="panel dist directory unavailable")
    result = GateResult()
    def walk_error(exc):
        raise exc

    for dirpath, _, filenames in os.walk(dist_dir, onerror=walk_error):
        for fn in filenames:
            fp = Path(dirpath) / fn
            text = _read_text(fp)
            if text is None:
                continue
            rel = os.path.relpath(fp, dist_dir).replace(os.sep, "/")
            result.scanned += 1
            result.hits.extend(_scan_text(text, rel, "panel_bundle", compiled, allowlist))
    return result.finalize()


def gate_runtime(url, token, compiled, allowlist) -> GateResult:
    if not url:
        return GateResult(status="skipped", reason="--runtime-url not supplied")
    import urllib.error
    import urllib.request

    endpoints = [
        "/api/health", "/api/auth/status", "/api/providers", "/api/settings",
        "/api/routing/combos", "/api/keys", "/api/activity", "/api/usage/analytics",
        "/panel/",
    ]
    result = GateResult()
    base = url.rstrip("/")
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    for ep in endpoints:
        try:
            req = urllib.request.Request(base + ep, headers=headers)
            with urllib.request.urlopen(req, timeout=10) as resp:
                body = resp.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as exc:
            try:
                with exc:
                    body = exc.read().decode("utf-8", errors="replace")
            except OSError:
                result.status = "fail"
                result.reason = "one or more runtime responses could not be read"
                continue
            result.status = "fail"
            result.reason = "one or more runtime requests returned an HTTP error; authenticated coverage incomplete"
        except (OSError, ValueError):
            result.status = "fail"
            result.reason = "one or more runtime requests could not be read"
            continue
        result.scanned += 1
        result.hits.extend(_scan_text(body, f"runtime:{ep}", "runtime", compiled, allowlist))
    return result.finalize()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="public-hygiene-gate")
    parser.add_argument("--repo-root", type=Path, default=REPO_ROOT_DEFAULT)
    parser.add_argument("--panel-dist-dir", type=Path, default=None)
    parser.add_argument("--runtime-url", type=str, default=None)
    parser.add_argument("--auth-token", type=str, default=None)
    parser.add_argument("--allowlist", type=Path, default=ALLOWLIST_DEFAULT)
    parser.add_argument("--private-patterns", type=Path, default=None)
    parser.add_argument("--private-allowlist", type=Path, default=None)
    parser.add_argument(
        "--evidence-dir", type=Path, default=None,
        help="override evidence output dir; defaults to <repo-root>/evidence",
    )
    args = parser.parse_args(argv)

    mod = load_patterns(args.private_patterns)
    compiled = compile_patterns(mod.PATTERNS)
    known = {p.name for p in mod.PATTERNS}
    allowlist = load_allowlist(args.allowlist, known)
    if args.private_allowlist is not None:
        if not mod.PRIVATE_LOADED:
            raise ValueError("private overlay requires private catalog")
        allowlist += load_bound_allowlist(args.private_allowlist, known)
    internal_doc_paths = getattr(mod, "INTERNAL_DOC_PATHS", [])

    report = Report(timestamp=utc_timestamp(), private_loaded=bool(getattr(mod, "PRIVATE_LOADED", False)))
    report.gates["operator_patterns"] = (GateResult() if report.private_loaded else
        GateResult(status="skipped", reason="operator-private patterns unavailable"))
    report.gates["tracked_files"] = gate_tracked_files(args.repo_root, compiled, allowlist)
    report.gates["filenames"] = gate_filenames(args.repo_root, compiled, internal_doc_paths, allowlist)
    report.gates["commit_history"] = gate_commit_history(args.repo_root, compiled, allowlist)
    report.gates["historical_files"] = gate_historical_files(args.repo_root, compiled, internal_doc_paths, allowlist)
    report.gates["panel_bundle"] = gate_panel_bundle(args.panel_dist_dir, compiled, allowlist)
    report.gates["runtime"] = gate_runtime(args.runtime_url, args.auth_token, compiled, allowlist)

    evidence_root = args.evidence_dir or (args.repo_root / "evidence")
    out_dir = evidence_root / report.timestamp
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "public-hygiene-report.json"
    out_path.write_text(report.to_json())
    os.chmod(out_path, 0o600)

    print(report.human_summary())
    return 0 if report.overall == "pass" else 1


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except Exception:
        # Exceptions can contain credentials, URLs, file paths or input snippets.
        print("public-hygiene-gate: scan error; clearance not granted", file=sys.stderr)
        sys.exit(1)

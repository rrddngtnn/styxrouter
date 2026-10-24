#!/usr/bin/env python3
"""Public-hygiene gate. Pre-publish check against five surfaces.

Usage:
    python3 scripts/public-hygiene-gate.py \
        --repo-root PATH \
        [--panel-dist-dir PATH] \
        [--runtime-url URL --auth-token TOKEN]

Writes evidence/<UTC>/public-hygiene-report.json (0600).
Exits non-zero on any unallowlisted fatal hit.

The raw matched substring is NEVER written to the report or stdout -- a hit
records only its pattern name, path, and line, with a redacted context marker.
That keeps the report safe to paste even when it catches a credential.
"""
from __future__ import annotations

import argparse
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
    ".png", ".jpg", ".jpeg", ".gif", ".ico", ".webp", ".bmp", ".svg",
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
        if self.status == "skipped":
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
            return "pass_with_skipped"
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


def load_patterns() -> Any:
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
    private_path = SCRIPTS_DIR / "hygiene_private.py"
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
        if e.get("pattern") not in known_patterns:
            raise ValueError(f"allowlist references unknown pattern: {e.get('pattern')}")
        if e.get("file", "").startswith("/"):
            raise ValueError(f"allowlist file must be repo-relative: {e['file']}")
        rng = e.get("lines")
        if rng and rng[0] > rng[1]:
            raise ValueError(f"allowlist bad line range: {rng}")
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


def _is_allowlisted(allowlist, pattern, path, line, text) -> bool:
    for e in allowlist:
        if e["pattern"] != pattern or e["file"] != path:
            continue
        if "section" in e:
            span = _section_span(text, e["section"])
            if span and span[0] <= line <= span[1]:
                return True
        elif "lines" in e:
            if e["lines"][0] <= line <= e["lines"][1]:
                return True
        else:
            return True  # whole-file allowlist
    return False


def _scan_text(text, path, surface, compiled, allowlist) -> list[Hit]:
    hits: list[Hit] = []
    for pdef, rx in compiled:
        if surface not in pdef.surfaces:
            continue
        for m in rx.finditer(text):
            line = text.count("\n", 0, m.start()) + 1
            if _is_allowlisted(allowlist, pdef.name, path, line, text):
                continue
            hits.append(Hit(
                surface=surface,
                path=path,
                pattern=pdef.name,
                line=line,
                redacted_context=f"[REDACTED-{pdef.name}]",
                severity=pdef.severity,
            ))
    return hits


def _read_text(fp: Path) -> str | None:
    if fp.suffix.lower() in _BINARY_EXT:
        return None
    try:
        raw = fp.read_bytes()
    except OSError:
        return None
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
    """Repo-relative paths. Prefers `git ls-files`; falls back to a filesystem
    walk when the root is not a git repo root or tracks nothing (fixtures)."""
    is_root = _git_toplevel(repo_root) == repo_root.resolve()
    if is_root:
        out = _git(repo_root, ["ls-files"])
        if out:
            return _drop_self_exempt([p for p in out.splitlines() if p])
    # fallback: walk the tree
    files = []
    for dirpath, dirnames, filenames in os.walk(repo_root):
        dirnames[:] = [d for d in dirnames if d not in (".git", "node_modules")]
        for fn in filenames:
            rel = os.path.relpath(os.path.join(dirpath, fn), repo_root)
            files.append(rel.replace(os.sep, "/"))
    return _drop_self_exempt(files)


def gate_tracked_files(repo_root, compiled, allowlist) -> GateResult:
    result = GateResult()
    for rel in _list_files(repo_root):
        fp = repo_root / rel
        if not fp.is_file() or fp.is_symlink():
            continue
        text = _read_text(fp)
        if text is None:
            continue
        result.scanned += 1
        result.hits.extend(_scan_text(text, rel, "tracked_file", compiled, allowlist))
    return result.finalize()


def gate_filenames(repo_root, compiled, internal_doc_paths, allowlist) -> GateResult:
    result = GateResult()
    doc_rx = [re.compile(r) for r in internal_doc_paths]
    for rel in _list_files(repo_root):
        result.scanned += 1
        for rx in doc_rx:
            if rx.search(rel):
                result.hits.append(Hit(
                    surface="filename", path=rel, pattern="P-INTERNAL-DOC",
                    line=0, redacted_context="[internal-doc tracked]",
                    severity="fatal",
                ))
        # apply content patterns to the path string itself
        result.hits.extend(_scan_text(rel, rel, "filename", compiled, allowlist))
    return result.finalize()


def gate_commit_history(repo_root, compiled, allowlist) -> GateResult:
    if _git_toplevel(repo_root) != repo_root.resolve():
        return GateResult(status="skipped", reason="not a git repo root")
    out = _git(repo_root, ["log", "--format=%H%n%B%n---COMMIT-END---"])
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


def gate_panel_bundle(dist_dir, compiled, allowlist) -> GateResult:
    if dist_dir is None or not dist_dir.is_dir():
        return GateResult(status="skipped", reason="no panel dist directory supplied")
    result = GateResult()
    for dirpath, _, filenames in os.walk(dist_dir):
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
        except Exception as exc:  # noqa: BLE001 - network best effort
            # 401/403 on an auth-gated route is safe; record nothing
            body = getattr(getattr(exc, "fp", None), "read", lambda: b"")()
            body = body.decode("utf-8", errors="replace") if isinstance(body, bytes) else ""
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
    parser.add_argument(
        "--evidence-dir", type=Path, default=None,
        help="override evidence output dir; defaults to <repo-root>/evidence",
    )
    args = parser.parse_args(argv)

    mod = load_patterns()
    compiled = compile_patterns(mod.PATTERNS)
    known = {p.name for p in mod.PATTERNS}
    allowlist = load_allowlist(args.allowlist, known)
    internal_doc_paths = getattr(mod, "INTERNAL_DOC_PATHS", [])

    report = Report(timestamp=utc_timestamp(), private_loaded=bool(getattr(mod, "PRIVATE_LOADED", False)))
    report.gates["tracked_files"] = gate_tracked_files(args.repo_root, compiled, allowlist)
    report.gates["filenames"] = gate_filenames(args.repo_root, compiled, internal_doc_paths, allowlist)
    report.gates["commit_history"] = gate_commit_history(args.repo_root, compiled, allowlist)
    report.gates["panel_bundle"] = gate_panel_bundle(args.panel_dist_dir, compiled, allowlist)
    report.gates["runtime"] = gate_runtime(args.runtime_url, args.auth_token, compiled, allowlist)

    evidence_root = args.evidence_dir or (args.repo_root / "evidence")
    out_dir = evidence_root / report.timestamp
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "public-hygiene-report.json"
    out_path.write_text(report.to_json())
    os.chmod(out_path, 0o600)

    print(report.human_summary())
    return 0 if report.overall != "fail" else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

#!/usr/bin/env python3
"""Reachability analyzer for the StyxRouter Hono host.

Seeds: server/** (active host), tests/*.test.ts (+ *.py's ts targets), the
callLogArtifact worker, and every route file under the mounted upstream trees
(src/app/api/{oauth-specific,usage,quota,providers/quota-windows} as configured
in server/upstream.ts / server/oauth.ts at the time of writing).

Outputs the set of UNREACHABLE code files (ts/tsx/js/mjs/cjs) under
server/, src/, open-sse/ — i.e. deletion candidates. Never lists:
  - src/lib/db/migrations/** (filesystem-loaded SQL)
  - tests/**
  - files reachable only via tests are REPORTED as reachable (we keep them).
"""
import re
import sys
import json
from pathlib import Path
from collections import deque

ROOT = Path(__file__).resolve().parents[1]

COMMENT_RE = re.compile(r"//[^\n]*|/\*[\s\S]*?\*/")
IMPORT_RE = re.compile(
    r"""(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']"""
    r"""|(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)"""
)
CODE_EXTS = (".ts", ".tsx", ".js", ".mjs", ".cjs")


def resolve_local(from_file: Path, spec: str):
    if spec == "next/server":
        c = ROOT / "server/shims/next-server.ts"
        return c.resolve() if c.exists() else None
    if spec == "next/headers":
        c = ROOT / "server/shims/next-headers.ts"
        return c.resolve() if c.exists() else None
    if spec == "@styxrouter/open-sse":
        base = ROOT / "open-sse"
    elif spec.startswith("@styxrouter/open-sse/"):
        base = ROOT / "open-sse" / spec[len("@styxrouter/open-sse/"):]
    elif spec.startswith("@/"):
        base = ROOT / "src" / spec[2:]
    elif spec.startswith(("./", "../")):
        base = from_file.parent / spec
    else:
        return None
    candidates = [base]
    for ext in CODE_EXTS:
        candidates.append(Path(str(base) + ext))
    if base.suffix in (".js", ".mjs", ".cjs"):
        stem = base.with_suffix("")
        for ext in (".ts", ".tsx", ".js", ".mjs", ".cjs"):
            candidates.append(Path(str(stem) + ext))
    for ext in CODE_EXTS:
        candidates.append(base / f"index{ext}")
    for c in candidates:
        if c.is_file():
            return c.resolve()
    return None


def parse_imports(f: Path):
    txt = f.read_text(encoding="utf-8", errors="replace")
    clean = COMMENT_RE.sub("", txt)
    specs = [m.group(1) or m.group(2) for m in IMPORT_RE.finditer(clean)]
    specs = [s for s in specs if s]
    if f.name == "oauth.ts" and f.parent.name == "server":
        for m in re.finditer(r'''import\s*\(\s*`\$\{r\}/([^`]+)`\s*\)''', clean):
            specs.append(f"../src/app/api/oauth/{m.group(1)}")
    return specs


def seeds():
    s = set()
    for f in (ROOT / "server").rglob("*.ts"):
        if f.is_file():
            s.add(f.resolve())
    for f in (ROOT / "tests").glob("*.test.ts"):
        if f.is_file():
            s.add(f.resolve())
    w = ROOT / "src/lib/usage/callLogArtifactWorker.ts"
    if w.is_file():
        s.add(w.resolve())
    up = ROOT / "server/upstream.ts"
    if up.is_file() and "mountNextTree" in up.read_text():
        for pref in json.loads(
            re.search(r"UPSTREAM_PREFIXES\s*=\s*(\[.*?\])\s*as const", up.read_text(), re.S).group(1)
            .replace("'", '"')
        ):
            base = ROOT / "src/app/api" / pref
            if base.exists():
                for rf in base.rglob("route.ts"):
                    if not any(p.startswith("[...") for p in rf.parts):
                        s.add(rf.resolve())
    return s


def main():
    visited = set()
    unresolved = []
    q = deque(seeds())
    while q:
        cur = q.popleft()
        if cur in visited or not cur.is_file():
            continue
        visited.add(cur)
        for spec in parse_imports(cur):
            is_local = (
                spec in ("next/server", "next/headers", "@styxrouter/open-sse")
                or spec.startswith(("@styxrouter/open-sse/", "@/", "./", "../"))
            )
            if not is_local:
                continue
            t = resolve_local(cur, spec)
            if t is None:
                if cur.parent.name == "tests" and spec.startswith("./src/"):
                    alt = (ROOT / spec[2:]).resolve()
                    if alt.is_file():
                        t = alt
            if t is None:
                unresolved.append((str(cur.relative_to(ROOT)), spec))
            elif t not in visited:
                q.append(t)

    all_code = set()
    for d in ("server", "src", "open-sse"):
        for f in (ROOT / d).rglob("*"):
            if f.is_file() and f.suffix in CODE_EXTS and "__pycache__" not in f.parts:
                rp = f.resolve()
                if "src/lib/db/migrations" in str(rp):
                    continue
                all_code.add(rp)

    unreachable = sorted(str(p.relative_to(ROOT)) for p in all_code - visited)
    out = {
        "reachable": len(visited & all_code),
        "total_code": len(all_code),
        "unreachable_count": len(unreachable),
        "unreachable": unreachable,
        "unresolved": unresolved,
    }
    Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/unreachable.json").write_text(
        json.dumps(out, indent=1)
    )
    print(
        f"code files: {out['total_code']} | reachable: {out['reachable']} | "
        f"UNREACHABLE: {out['unreachable_count']} | unresolved: {len(unresolved)}"
    )


if __name__ == "__main__":
    main()

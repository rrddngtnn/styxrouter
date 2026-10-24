#!/usr/bin/env python3
"""Verify every local import in a tree resolves to a real file.

Unlike a naive import-spec scan, this follows symlinks (candidate trees are
mostly symlinks to the installed root) and actually checks that each resolved
target exists on disk. It also produces a baseline comparison so a candidate
tree can be diffed against the pristine install.

A spec is considered resolvable when, relative to the importing file:
  - the literal path exists, or
  - path + ".ts" exists, or
  - path + ".tsx" exists, or
  - path + "/index.ts" exists

Bare specifiers (node:*, npm packages) and the known-missing `@/app/*` tree
(dashboard source is excluded from the published package) are reported
separately, never as failures.
"""
import argparse
import json
import os
from pathlib import Path
import re
import sys

IMPORT_RE = re.compile(r'''(?:from\s+|require\(\s*)["']([^"']+)["']''')
KNOWN_ABSENT_PREFIXES = ("@/app/", "@/i18n/", "@/store/")


def resolve(base: Path) -> bool:
    return any(
        c.exists()
        for c in (base, Path(str(base) + ".ts"), Path(str(base) + ".tsx"), base / "index.ts")
    )


def scan(root: Path) -> dict:
    unresolved: list[dict] = []
    skipped_known = 0
    total = 0

    for dirpath, dirnames, filenames in os.walk(root, followlinks=True):
        dirnames[:] = [d for d in dirnames if d not in ("node_modules", "dist", ".git", ".build")]
        for fn in filenames:
            if not fn.endswith((".ts", ".tsx")):
                continue
            p = Path(dirpath) / fn
            try:
                text = p.read_text(errors="replace")
            except OSError:
                continue
            for m in IMPORT_RE.finditer(text):
                spec = m.group(1)
                if not spec.startswith((".", "@/")):
                    continue
                total += 1
                if spec.startswith(KNOWN_ABSENT_PREFIXES):
                    skipped_known += 1
                    continue
                base = (root / "src" / spec[2:]) if spec.startswith("@/") else (p.parent / spec)
                if resolve(base):
                    continue
                unresolved.append({
                    "file": str(p.relative_to(root)),
                    "spec": spec,
                })
    return {
        "root": str(root),
        "total_local_imports": total,
        "known_absent_dashboard_imports": skipped_known,
        "unresolved": unresolved,
        "unresolved_count": len(unresolved),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--root", type=Path, required=True)
    ap.add_argument("--output", type=Path, required=True)
    ap.add_argument("--baseline-root", type=Path, default=None,
                    help="Pristine tree to diff against; failures must not exceed baseline")
    args = ap.parse_args()

    result = scan(args.root)

    baseline_count = None
    if args.baseline_root:
        base = scan(args.baseline_root)
        baseline_count = base["unresolved_count"]
        base_specs = {(u["spec"]) for u in base["unresolved"]}
        new_specs = sorted({u["spec"] for u in result["unresolved"]} - base_specs)
        result["baseline"] = {
            "root": str(args.baseline_root),
            "unresolved_count": baseline_count,
            "new_specs_not_in_baseline": new_specs,
        }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2))
    args.output.chmod(0o600)

    print(f"local imports: {result['total_local_imports']}")
    print(f"known-absent (dashboard src): {result['known_absent_dashboard_imports']}")
    print(f"unresolved: {result['unresolved_count']}")
    if baseline_count is not None:
        print(f"baseline unresolved: {baseline_count}")
        new = result["baseline"]["new_specs_not_in_baseline"]
        print(f"new specs not in baseline: {len(new)}")
        for s in new:
            print(f"  NEW {s}")
        if new:
            return 1
    for u in result["unresolved"][:20]:
        print(f"  {u['file']} -> {u['spec']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

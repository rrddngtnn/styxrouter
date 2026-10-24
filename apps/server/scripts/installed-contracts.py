#!/usr/bin/env python3
"""Installed-contract gate: regression check on compiled artifacts.

The npm-published StyxRouter package does not ship the full src/app tree or
devDependencies, so a true unit-test harness against the installed root is
not possible. What IS possible: a byte-level regression gate on the
compiled runtime files that already carry our local patches.

Each contract declares a file path and either:
- must_contain: list of literal substrings that must be present
- must_not_contain: list of literal substrings that must NOT be present
- sha256: exact bytes pin

A missing file, missing required substring, present forbidden substring,
or sha256 mismatch returns a failure line. No file bytes are ever printed.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys


def check(root: Path, contracts: list[dict]) -> list[str]:
    root = Path(root)
    failures: list[str] = []
    for contract in contracts:
        name = contract.get("name", "<unnamed>")
        rel = contract["file"]
        path = Path(rel) if Path(rel).is_absolute() else root / rel
        if not path.is_file():
            failures.append(f"[{name}] file missing: {path}")
            continue
        data = path.read_bytes()
        if "sha256" in contract:
            actual = hashlib.sha256(data).hexdigest()
            expected = contract["sha256"]
            if actual != expected:
                failures.append(f"[{name}] sha256 mismatch: expected {expected} got {actual}")
                continue
        text = None
        if contract.get("must_contain") or contract.get("must_not_contain"):
            try:
                text = data.decode("utf-8", errors="replace")
            except Exception as err:
                failures.append(f"[{name}] decode error: {err}")
                continue
        for literal in contract.get("must_contain", []):
            if literal not in text:
                failures.append(f"[{name}] missing required anchor (not disclosed in output)")
                break
        for literal in contract.get("must_not_contain", []):
            if literal in text:
                failures.append(f"[{name}] forbidden anchor present (not disclosed in output)")
                break
    return failures


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--contracts", type=Path, required=True)
    parser.add_argument("--report", type=Path, default=None)
    args = parser.parse_args()
    try:
        contracts = json.loads(args.contracts.read_text())
    except (OSError, ValueError) as err:
        print(f"ERROR: cannot read contracts: {err}", file=sys.stderr)
        return 1
    failures = check(args.root, contracts)
    if args.report is not None:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps({"contracts": len(contracts),
                                           "failures": failures}, indent=2))
        args.report.chmod(0o600)
    if failures:
        for line in failures:
            print(line, file=sys.stderr)
        return 1
    print(f"OK: {len(contracts)} contracts passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())

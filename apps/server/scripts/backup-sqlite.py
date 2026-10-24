#!/usr/bin/env python3
"""Consistent SQLite backup via the backup API; integrity-checks and reports.

Uses sqlite3.Connection.backup, which handles WAL/journal consistency, so a
live writer cannot tear the file. Never reads row contents into the report;
the report records sizes, hashes, row counts, and integrity_check status.

Reads source read-only; writes backup 0o600; refuses to overwrite.
Not a code-rollback tool: file-only, no application-level consistency.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sqlite3
import sys
import tempfile


def _sha256(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def _row_counts(conn: sqlite3.Connection) -> dict[str, int]:
    counts = {}
    tables = [row[0] for row in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchall()]
    for name in tables:
        counts[name] = conn.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()[0]
    return counts


def backup(source: Path, destination: Path, *, report: Path | None = None) -> Path:
    source, destination = Path(source), Path(destination)
    if not source.is_file():
        raise FileNotFoundError(f"source db missing: {source}")
    if destination.exists():
        raise FileExistsError(f"backup destination exists: {destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    # Use a staging file in the destination directory, then atomic rename.
    staging_fd, staging_path = tempfile.mkstemp(prefix=".sqlite-backup-", dir=destination.parent)
    staging = Path(staging_path)
    try:
        import os as _os
        _os.close(staging_fd)
        staging.unlink()
        source_conn = sqlite3.connect(f"file:{source}?mode=ro", uri=True)
        try:
            destination_conn = sqlite3.connect(staging)
            try:
                source_conn.backup(destination_conn)
                destination_conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
                integrity = destination_conn.execute("PRAGMA integrity_check").fetchone()[0]
                counts = _row_counts(destination_conn)
            finally:
                destination_conn.close()
        finally:
            source_conn.close()
        staging.chmod(0o600)
        import os
        os.replace(staging, destination)
        staging = None
    finally:
        if staging is not None and staging.exists():
            staging.unlink()
    if report is not None:
        report = Path(report)
        report.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "source_path": str(source),
            "source_bytes": source.stat().st_size,
            "backup_path": str(destination),
            "backup_bytes": destination.stat().st_size,
            "backup_sha256": _sha256(destination),
            "integrity_check": integrity,
            "row_counts": counts,
        }
        report.write_text(json.dumps(payload, indent=2, sort_keys=True))
        report.chmod(0o600)
    if integrity != "ok":
        raise RuntimeError(f"integrity_check failed: {integrity}")
    return destination


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--report", type=Path, default=None)
    args = parser.parse_args()
    try:
        backup(args.source, args.destination, report=args.report)
    except (OSError, FileExistsError, FileNotFoundError, sqlite3.Error, RuntimeError) as err:
        print(f"ERROR: {err}", file=sys.stderr)
        return 1
    print(f"OK: backup {args.destination}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

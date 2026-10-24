#!/usr/bin/env python3
"""Fixture-only snapshot/verify/restore, not a production backup tool.

Supports ordinary files/directories and permission modes in a trusted local
workspace without concurrent writers. No symlinks, ownership, ACLs, xattrs,
fsync/crash-durability guarantee, or live-database consistency. A failed
restore can leave a partial destination; never use it on installed state.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import sys
import tempfile


def _inventory(root: Path) -> list[dict]:
    def _raise(err: OSError) -> None:
        raise err
    entries = []
    root_stat = root.lstat()
    yield_order = [(".", root_stat)]
    for dirpath, dirnames, filenames in os.walk(root, onerror=_raise, followlinks=False):
        dirnames.sort()
        filenames.sort()
        parent = Path(dirpath)
        for name in dirnames + filenames:
            child = parent / name
            yield_order.append((child.relative_to(root).as_posix(), child.lstat()))
    for relative, info in yield_order:
        if not (stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode)):
            raise ValueError("symlinks and special files are unsupported")
        if stat.S_IMODE(info.st_mode) & 0o7000:
            raise ValueError("special permission bits are unsupported")
        entry = {"path": relative, "kind": "dir" if stat.S_ISDIR(info.st_mode) else "file",
                 "mode": stat.S_IMODE(info.st_mode)}
        if entry["kind"] == "file":
            with (root / relative).open("rb") as handle:
                entry["sha256"] = hashlib.file_digest(handle, "sha256").hexdigest()
        entries.append(entry)
    entries.sort(key=lambda e: e["path"])
    return entries


def _copy(source: Path, destination: Path, entries: list[dict]) -> None:
    destination.mkdir(exist_ok=True, mode=0o700)
    for entry in entries:
        target = destination / entry["path"]
        if entry["kind"] == "dir":
            target.mkdir(exist_ok=True, mode=0o700)
        else:
            shutil.copyfile(source / entry["path"], target)
            target.chmod(entry["mode"])
    for entry in reversed(entries):
        if entry["kind"] == "dir":
            (destination / entry["path"]).chmod(entry["mode"])


def _separate(source: Path, destination: Path) -> None:
    a, b = source.resolve(), destination.resolve()
    if a.is_relative_to(b) or b.is_relative_to(a):
        raise ValueError("source and destination overlap")
    for path in [destination, *destination.parents]:
        if path.is_symlink():
            raise ValueError("symlink destination")


def snapshot(source: Path, destination: Path) -> Path:
    source, destination = Path(source), Path(destination)
    _separate(source, destination)
    if destination.exists():
        raise ValueError("snapshot destination exists")
    entries = _inventory(source)
    with tempfile.TemporaryDirectory(prefix=".snapshot-", dir=destination.parent) as temporary:
        staging_root = Path(temporary) / "snapshot"
        staging_root.mkdir(mode=0o700)
        _copy(source, staging_root / "payload", entries)
        if _inventory(source) != entries or _inventory(staging_root / "payload") != entries:
            raise ValueError("snapshot changed while copying")
        manifest = staging_root / "manifest.json"
        manifest.write_text(json.dumps({"version": 1, "entries": entries}, indent=2))
        manifest.chmod(0o600)
        os.replace(staging_root, destination)
    return destination / "manifest.json"


def _reject_symlinks_on_path(path: Path) -> None:
    for component in [path, *path.parents]:
        if component.is_symlink():
            raise ValueError("symlink on path")


def verify(snapshot_root: Path) -> list[str]:
    snapshot_root = Path(snapshot_root)
    try:
        _reject_symlinks_on_path(snapshot_root)
        manifest_path = snapshot_root / "manifest.json"
        if manifest_path.is_symlink():
            return ["manifest is a symlink"]
        manifest = json.loads(manifest_path.read_text())
        if manifest["version"] != 1 or not isinstance(manifest["entries"], list):
            return ["invalid manifest"]
        return [] if _inventory(snapshot_root / "payload") == manifest["entries"] else ["payload mismatch"]
    except (OSError, ValueError, KeyError, TypeError):
        return ["unreadable or invalid snapshot"]


def restore(snapshot_root: Path, destination: Path) -> None:
    snapshot_root, destination = Path(snapshot_root), Path(destination)
    _separate(snapshot_root, destination)
    if destination.exists() and (not destination.is_dir() or any(destination.iterdir())):
        raise ValueError("restore destination must be empty")
    if verify(snapshot_root):
        raise ValueError("snapshot verification failed")
    entries = json.loads((snapshot_root / "manifest.json").read_text())["entries"]
    _copy(snapshot_root / "payload", destination, entries)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for command in ["snapshot", "restore"]:
        sub = commands.add_parser(command)
        sub.add_argument("source", type=Path)
        sub.add_argument("destination", type=Path)
    commands.add_parser("verify").add_argument("source", type=Path)
    args = parser.parse_args()
    try:
        if args.command == "verify":
            if verify(args.source):
                raise ValueError("snapshot verification failed")
        elif args.command == "snapshot":
            snapshot(args.source, args.destination)
        else:
            restore(args.source, args.destination)
    except (OSError, ValueError, KeyError, TypeError):
        print("ERROR: operation failed; check paths and snapshot integrity", file=sys.stderr)
        return 1
    print(f"OK: {args.command}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

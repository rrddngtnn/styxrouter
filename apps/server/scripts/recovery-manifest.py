#!/usr/bin/env python3
"""Boot/decryption recovery manifest. References only, never secret values.

Collects the paths, modes, ownership, and sha256 of the systemd unit, its
drop-ins, the ExecStart binary, the data root, and env files; records env
file content as KEY NAMES only. Produces a markdown manifest suitable for
operator review before any destructive change. Reads only; never writes to
production. Not a backup; no secret value ever enters the output.
"""
import argparse
import hashlib
from pathlib import Path
import re
import stat
import sys


def _file_meta(path: Path, hash_file: bool = True) -> dict:
    info = path.lstat()
    meta = {"path": str(path), "mode": stat.S_IMODE(info.st_mode),
            "uid": info.st_uid, "gid": info.st_gid, "bytes": info.st_size}
    if hash_file and stat.S_ISREG(info.st_mode):
        try:
            with path.open("rb") as handle:
                meta["sha256"] = hashlib.file_digest(handle, "sha256").hexdigest()
        except PermissionError:
            meta["sha256"] = None
    return meta


def _parse_environment(text: str) -> list[str]:
    keys = []
    for line in text.splitlines():
        match = re.match(r'^\s*Environment\s*=\s*"?([A-Za-z_][A-Za-z0-9_]*)=', line)
        if match:
            keys.append(match.group(1))
    return keys


def _parse_execstart(text: str) -> str | None:
    for line in text.splitlines():
        match = re.match(r'^\s*ExecStart\s*=\s*(\S+)', line)
        if match:
            return match.group(1)
    return None


def _env_key_names(path: Path) -> dict:
    try:
        text = path.read_text()
    except OSError as err:
        return {**_file_meta(path), "keys": [], "note": f"unreadable: {err.strerror}"}
    keys = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key = stripped.split("=", 1)[0].strip()
        if re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", key):
            keys.append(key)
    return {**_file_meta(path), "keys": keys}


def collect(unit_file: Path, drop_in_dir: Path, data_root: Path,
            env_files: list[Path]) -> dict:
    unit_file, drop_in_dir, data_root = Path(unit_file), Path(drop_in_dir), Path(data_root)
    if not unit_file.is_file():
        raise FileNotFoundError(f"unit file missing: {unit_file}")
    if not data_root.is_dir():
        raise FileNotFoundError(f"data root missing: {data_root}")
    unit_text = unit_file.read_text()
    drop_ins = []
    environment_keys = list(_parse_environment(unit_text))
    if drop_in_dir.is_dir():
        for conf in sorted(drop_in_dir.glob("*.conf")):
            drop_ins.append({**_file_meta(conf), "env_keys": _parse_environment(conf.read_text())})
            environment_keys.extend(_parse_environment(conf.read_text()))
    exec_path = _parse_execstart(unit_text)
    binary_meta = None
    if exec_path and Path(exec_path).is_file():
        binary_meta = _file_meta(Path(exec_path))
    data_info = data_root.lstat()
    return {
        "unit_file": _file_meta(unit_file),
        "drop_ins": drop_ins,
        "exec_start_literal": exec_path,
        "exec_binary": binary_meta,
        "data_root": {"path": str(data_root), "mode": stat.S_IMODE(data_info.st_mode),
                      "uid": data_info.st_uid, "gid": data_info.st_gid},
        "environment_keys": sorted(set(environment_keys)),
        "env_files": [_env_key_names(Path(p)) for p in env_files],
    }


def _fmt_meta(meta: dict) -> str:
    parts = [f"path={meta['path']}", f"mode=0o{meta['mode']:03o}",
             f"uid={meta['uid']}", f"gid={meta['gid']}", f"bytes={meta['bytes']}"]
    if "sha256" in meta:
        parts.append(f"sha256={meta['sha256']}")
    return " ".join(parts)


def render(data: dict) -> str:
    lines = ["# Boot/decryption recovery manifest", "",
             "Operator reference only. No secret values are recorded here.",
             "References must be verified recoverable before destructive changes.", ""]
    lines += ["## Unit file", f"- {_fmt_meta(data['unit_file'])}", ""]
    lines += ["## Drop-ins"]
    if not data["drop_ins"]:
        lines.append("- (none)")
    for drop in data["drop_ins"]:
        lines.append(f"- {_fmt_meta(drop)}")
        if drop["env_keys"]:
            lines.append(f"  - env keys: {', '.join(drop['env_keys'])}")
    lines.append("")
    lines += ["## ExecStart binary",
              f"- literal: {data['exec_start_literal']}"]
    if data["exec_binary"]:
        lines.append(f"- {_fmt_meta(data['exec_binary'])}")
    else:
        lines.append("- binary not resolved on disk (verify before restore)")
    lines.append("")
    data_root = data["data_root"]
    lines += ["## Data root",
              f"- path={data_root['path']} mode=0o{data_root['mode']:03o} "
              f"uid={data_root['uid']} gid={data_root['gid']}", ""]
    lines += ["## Environment keys",
              "- " + ", ".join(data["environment_keys"] or ["(none)"]), ""]
    lines += ["## Env files (metadata only)"]
    if not data["env_files"]:
        lines.append("- (none referenced)")
    for env in data["env_files"]:
        lines.append(f"- {_fmt_meta(env)}")
        if env.get("note"):
            lines.append(f"  - note: {env['note']}")
        if env.get("keys"):
            lines.append(f"  - keys: {', '.join(env['keys'])}")
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--unit-file", type=Path, required=True)
    parser.add_argument("--drop-in-dir", type=Path, required=True)
    parser.add_argument("--data-root", type=Path, required=True)
    parser.add_argument("--env-file", type=Path, action="append", default=[])
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        data = collect(args.unit_file, args.drop_in_dir, args.data_root, args.env_file)
        text = render(data)
    except (OSError, FileNotFoundError, ValueError) as err:
        print(f"ERROR: {err}", file=sys.stderr)
        return 1
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(text)
    args.output.chmod(0o600)
    print(f"OK: wrote {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Decode protected scanner inputs without logging their content.

The optional gzip secret is additive: older workflows keep using the unchanged
legacy base64 JSON secret. A present gzip value never falls back on failure.
"""
import base64
import importlib.util
import json
import os
from pathlib import Path
import sys
import zlib

MAX_INPUT_BYTES = 1024 * 1024
MAX_ENCODED_CHARS = 4 * ((MAX_INPUT_BYTES + 2) // 3)


def decode(value: str, *, compressed: bool = False) -> bytes:
    if not value or len(value) > MAX_ENCODED_CHARS:
        raise ValueError('missing or oversized protected input')
    data = base64.b64decode(value, validate=True)
    if compressed:
        stream = zlib.decompressobj(wbits=31)
        data = stream.decompress(data, MAX_INPUT_BYTES + 1)
        if len(data) > MAX_INPUT_BYTES or not stream.eof or stream.unused_data or stream.unconsumed_tail:
            raise ValueError('invalid or oversized gzip input')
    if len(data) > MAX_INPUT_BYTES:
        raise ValueError('oversized protected input')
    data.decode('utf-8', errors='strict')
    return data


def write_private(path: Path, data: bytes) -> None:
    # Refuse pre-existing files and symlinks; never follow a scratch collision.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as output:
        output.write(data)


def main() -> int:
    created = []
    try:
        scratch = Path(os.environ['RUNNER_TEMP'])
        catalog = decode(os.environ.get('PRIVATE_CATALOG_B64', ''))
        compressed = os.environ.get('PRIVATE_ALLOWLIST_GZIP_B64', '')
        allowlist = decode(compressed or os.environ.get('PRIVATE_ALLOWLIST_B64', ''),
                           compressed=bool(compressed))
        entries = json.loads(allowlist.decode('utf-8'))
        catalog_path = scratch / 'hygiene_private.py'
        write_private(catalog_path, catalog)
        created.append(catalog_path)
        spec = importlib.util.spec_from_file_location('protected_hygiene_gate', Path(__file__).with_name('public-hygiene-gate.py'))
        if spec is None or spec.loader is None:
            raise ValueError('scanner unavailable')
        gate = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = gate
        spec.loader.exec_module(gate)
        patterns = gate.load_patterns(catalog_path)
        gate._validate_bound_entries(entries, {p.name for p in patterns.PATTERNS})
        target = scratch / 'hygiene_private_allowlist.json'
        write_private(target, allowlist)
        created.append(target)
        return 0
    except Exception:
        for path in created:
            path.unlink(missing_ok=True)
        # Neither parser exceptions nor tracebacks may disclose secret values.
        print('Protected hygiene inputs are missing or invalid.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())

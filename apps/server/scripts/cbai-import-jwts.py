#!/usr/bin/env python3
"""
cbai-import-jwts.py — bulk import raw CBAI JWTs into StyxRouter's provider_connections.

Reads one JWT per line from stdin (or --file). Each JWT becomes an apikey
auth row for provider=codebuddy-intl, encrypted with the StyxRouter salt and
the STORAGE_ENCRYPTION_KEY read from candidate/styx/.env. Rows marked
is_active=1. Existing rows for the same provider are LEFT ALONE unless
--replace is passed.

Why apikey instead of oauth: CBAI JWTs do not survive StyxRouter's oauth
refresh pipeline — the refresh endpoint returns 401 for these token types,
which then marks every connection expired and breaks dispatch. Storing them
as apikey (token in api_key column) skips the refresh pipeline entirely.
"""

from __future__ import annotations
import argparse, os, sqlite3, sys, uuid, re
from pathlib import Path

try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.scrypt import Scrypt
except ImportError:
    sys.exit("missing dep: pip install cryptography")

STYX_ROOT = Path("/home/youruser/styx-maintenance/candidate/styx")
STYX_DB = Path("/home/youruser/styx/databases/storage.sqlite")
STYX_SALT = b"styx-field-encryption-v1"
JWT_RE = re.compile(r"^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$")


def read_secret(env_path: Path) -> str:
    for line in env_path.read_text().splitlines():
        if line.startswith("STORAGE_ENCRYPTION_KEY="):
            return line.split("=", 1)[1].strip()
    sys.exit(f"STORAGE_ENCRYPTION_KEY not found in {env_path}")


def derive_key(secret: str) -> bytes:
    return Scrypt(salt=STYX_SALT, length=32, n=2**14, r=8, p=1).derive(secret.encode())


def encrypt(plain: str, key: bytes) -> str:
    iv = os.urandom(16)
    ct_tag = AESGCM(key).encrypt(iv, plain.encode(), None)
    ct, tag = ct_tag[:-16], ct_tag[-16:]
    return f"enc:v1:{iv.hex()}:{ct.hex()}:{tag.hex()}"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.strip().split("\n")[0])
    ap.add_argument("--file", type=Path, help="read JWTs from file instead of stdin")
    ap.add_argument("--env", type=Path, default=STYX_ROOT / ".env", help="Styx .env path")
    ap.add_argument("--db", type=Path, default=STYX_DB, help="Styx storage.sqlite path")
    ap.add_argument("--provider", default="codebuddy-intl", help="provider id (default: codebuddy-intl)")
    ap.add_argument("--prefix", default="CBAI-Imp", help="connection name prefix")
    ap.add_argument("--replace", action="store_true", help="delete all existing rows for this provider first")
    ap.add_argument("--dry-run", action="store_true", help="report what would be inserted, do not write")
    args = ap.parse_args()

    if not args.env.exists():
        sys.exit(f"env file missing: {args.env}")
    if not args.db.exists():
        sys.exit(f"db missing: {args.db}")

    source = args.file.open() if args.file else sys.stdin
    raw_lines = [ln.strip() for ln in source if ln.strip() and not ln.startswith("#")]

    tokens: list[str] = []
    rejected: list[str] = []
    for ln in raw_lines:
        if JWT_RE.match(ln):
            tokens.append(ln)
        else:
            rejected.append(ln[:40] + "...")

    print(f"accepted: {len(tokens)} tokens  rejected: {len(rejected)}", file=sys.stderr)
    for r in rejected[:5]:
        print(f"  reject: {r}", file=sys.stderr)
    if not tokens:
        sys.exit("no valid JWTs on input")

    if args.dry_run:
        print(f"[dry-run] would insert {len(tokens)} rows for provider={args.provider}", file=sys.stderr)
        return 0

    secret = read_secret(args.env)
    key = derive_key(secret)

    db = sqlite3.connect(str(args.db))
    try:
        if args.replace:
            cur = db.execute("DELETE FROM provider_connections WHERE provider=?", (args.provider,))
            print(f"deleted {cur.rowcount} existing rows for {args.provider}", file=sys.stderr)

        inserted = 0
        for i, jwt in enumerate(tokens, start=1):
            conn_id = str(uuid.uuid4())
            name = f"{args.prefix}-{i:03d}"
            enc = encrypt(jwt, key)
            db.execute(
                """INSERT INTO provider_connections
                   (id, provider, name, auth_type, api_key, is_active, created_at, updated_at)
                   VALUES (?, ?, ?, 'apikey', ?, 1, datetime('now'), datetime('now'))""",
                (conn_id, args.provider, name, enc),
            )
            inserted += 1
        db.commit()
        print(f"inserted {inserted} rows", file=sys.stderr)
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())

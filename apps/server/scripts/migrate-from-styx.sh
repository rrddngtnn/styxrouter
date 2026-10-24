#!/usr/bin/env bash
# migrate-from-styx.sh
#
# One-time migration from an StyxRouter install to StyxRouter.
# Re-encrypts credential fields in storage.sqlite under the new static
# salt and (optionally) rewrites STYX_* env vars in files you point
# at. Idempotent: a DB already on the Styx salt is detected and skipped.
#
# Nothing in this script phones home. The old DB is backed up before
# any write happens; the script aborts cleanly on any error.

set -euo pipefail

SRC_DB="${SRC_DB:-$HOME/styx/databases/storage.sqlite}"
SRC_ENV="${SRC_ENV:-$HOME/styx/databases/.env}"
SECRET_VAR="${SECRET_VAR:-STORAGE_ENCRYPTION_KEY}"
OLD_SALT="${OLD_SALT:-styx-field-encryption-v1}"
NEW_SALT="${NEW_SALT:-styx-field-encryption-v1}"
ENV_FILES="${ENV_FILES:-}"           # optional: ":"-separated paths to also sed STYX_ -> STYX_

usage() {
  cat <<EOF
Usage: $0 [--dry-run] [--env-files file1:file2:...]

Env knobs (all optional):
  SRC_DB=path/to/storage.sqlite       default: ~/styx/databases/storage.sqlite
  SRC_ENV=path/to/.env                default: alongside SRC_DB
  OLD_SALT=styx-field-encryption-v1
  NEW_SALT=styx-field-encryption-v1
  ENV_FILES=file1:file2               extra .env/systemd files to rewrite STYX_*
EOF
}

DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --env-files) shift; ENV_FILES="$1" ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown arg: $1" >&2; usage; exit 2 ;;
  esac
  shift
done

if [ ! -f "$SRC_DB" ]; then
  echo "SRC_DB not found: $SRC_DB" >&2
  exit 1
fi
if [ ! -f "$SRC_ENV" ]; then
  echo "SRC_ENV not found: $SRC_ENV (needed for secret)" >&2
  exit 1
fi

SECRET=$(grep -E "^${SECRET_VAR}=" "$SRC_ENV" | head -1 | cut -d= -f2-)
if [ -z "$SECRET" ]; then
  echo "could not read ${SECRET_VAR} from $SRC_ENV" >&2
  exit 1
fi

TS=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP_DB="${SRC_DB}.pre-styx-${TS}"
echo "backup → $BACKUP_DB"
[ $DRY -eq 0 ] && cp -a "$SRC_DB" "$BACKUP_DB"

MIGRATE_SCRIPT="$(dirname "$0")/migrate-salt.mjs"
if [ ! -f "$MIGRATE_SCRIPT" ]; then
  echo "migrate-salt.mjs not found at $MIGRATE_SCRIPT" >&2
  exit 1
fi

echo "re-encrypting enc:v1 fields: $OLD_SALT → $NEW_SALT"
if [ $DRY -eq 0 ]; then
  bun "$MIGRATE_SCRIPT" "$SRC_DB" "$SECRET" "$SECRET" "$OLD_SALT" "$NEW_SALT"
else
  echo "(dry-run) skipped"
fi

if [ -n "$ENV_FILES" ]; then
  IFS=':' read -ra FILES <<< "$ENV_FILES"
  for f in "${FILES[@]}"; do
    [ -f "$f" ] || { echo "skip (not a file): $f"; continue; }
    HITS=$(grep -c "STYX_" "$f" || true)
    echo "$f: $HITS STYX_ occurrences"
    if [ $DRY -eq 0 ] && [ "$HITS" -gt 0 ]; then
      cp -a "$f" "${f}.pre-styx-${TS}"
      sed -i 's|STYX_|STYX_|g' "$f"
    fi
  done
fi

cat <<EOF

Done. Next steps:
  1. Point StyxRouter at the migrated DB:
       export DATA_DIR=$(dirname "$SRC_DB")
       export STORAGE_ENCRYPTION_KEY=<same secret bytes>
     (or write them into candidate/styx/.env)
  2. Boot: STYX_HONO=1 bun candidate/styx/bin/styx.mjs serve
  3. Verify a provider dispatch; the backup is at $BACKUP_DB.
EOF

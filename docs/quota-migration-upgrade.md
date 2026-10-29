# Additive quota migration upgrade

## Numbering and compatibility

The deployment-ledger audit found historical migrations occupying every numeric slot
from 163 through 175. In particular, 163 is `model_capabilities`, 164 is
`retire_microsoft_designer_web`, and 165 is `retire_felo_web`. The runner tracks
versions, not `(version, name)` pairs: unpublished quota migrations at 163–165
would be skipped on an existing deployment, even though their schema is absent.

The quota migrations therefore use new slots after that historical range:

| Old unpublished filename | Additive filename |
| --- | --- |
| `163_quota_pool_exclusive.sql` | `176_quota_pool_exclusive.sql` |
| `164_quota_reserved_pool_id.sql` | `177_quota_reserved_pool_id.sql` |
| `165_quota_combo_generation.sql` | `178_quota_combo_generation.sql` |

SQL contents were preserved by the original renumbering; migration 178 was later
corrected to watch group-ID updates. Do not rewrite or delete historical
ledger rows to make the old slots available. No new reconciliation-map entries are
needed: the new slots apply independently of whatever historical name occupies
163–175. Historical SQL files for those slots are not reconstructed by this fix;
restoring the upstream migration inventory is a separate task, not permission to
reuse occupied numbers.

Semantics remain unchanged:

- Existing pools receive `exclusive = NULL` (unknown), not an inference from key
  allowlists. Explicit pre-existing true/false values remain unchanged.
- Key allowlists, allocations, and existing identifiers are not rewritten.
- New inserts and ID updates cannot use `__quota_access_revoked__`. A pre-existing
  collision remains stored; quota scope resolution must continue to deny it.
- The durable combo generation and source-mutation triggers are installed without
  resetting a pre-existing generation.
- A second migration run is a no-op.

Migration 176 contains only one `ALTER TABLE`; the runner's existing duplicate-column
handling is sufficient for a database that already has the exclusivity column.
Migration 179 adds the independent catalog-permission revision. Migration 181
repairs the original 178 group-update trigger on databases where 178 was already
recorded, and advances the generation to invalidate previously built projections.
Slot 180 is reserved for concurrent work. A fresh 178 watches both group ID and
name; 181 makes that true for already-upgraded databases as well.

Migrations 177 and 178 use `IF NOT EXISTS` / `INSERT OR IGNORE`, allowing them to
complete missing guards without discarding existing state.

## Recorded verification

All execution below is isolated test execution; no production startup, migration,
restart, or ledger write was performed. The live ledger was inspected through a
read-only SQLite connection with `query_only` enabled; only ledger names and schema
metadata were queried.

The new regression initially reproduced the bug: three name mismatches were
reported and the runner returned zero applied migrations. After renumbering, it
applied exactly 176, 177, and 178.

Run from the repository root:

```sh
bun run server:test \
  tests/quota-migration-upgrade-regression.test.ts \
  tests/quota-migration-176-ambiguity-regression.test.ts \
  tests/quota-reserved-id-db-regression.test.ts \
  tests/quota-legacy-unknown-regression.test.ts
```

Recorded result: **4 isolated test files passed, 0 failed**. Coverage includes a
historical-ledger fixture through 175; unchanged historical rows and timestamps;
unknown legacy pools; preserved explicit exclusivity and permissions; existing
reserved-ID collision preservation with insert/update guards; generation seeding,
trigger installation and increment; a pre-existing generation; a repeated no-op
upgrade; and fresh isolated database initialization through the new slots.

This establishes migration correctness on fixtures and isolated databases, not a
production deployment or a full repository test-suite result.

### Follow-up: migrations 179 and 181

A separate fixture freezes the migration directory at 179 and starts with the
known historical tail through 175, rather than marking 179 as already applied.
It verifies exactly 176–179 apply, historical ledger rows remain unchanged, the
permission revision advances on policy changes but not last-used writes, and a
second run is a no-op. An isolated already-applied-178 fixture verifies the 181
repair, including its one-time generation increment.

```sh
bun run server:test tests/quota-migration-upgrade-regression.test.ts \
  tests/quota-migration-181-group-id-regression.test.ts \
  tests/quota-combo-generation-regression.test.ts \
  tests/quota-catalog-permission-cache-regression.test.ts
```

Recorded result: **4 isolated test files passed, 0 failed**. No production
migration, database change, restart, or commit was performed.

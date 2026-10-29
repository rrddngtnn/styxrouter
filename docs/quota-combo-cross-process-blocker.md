# Quota combo cross-process reconciliation

The stale asynchronous writer regression is fixed by a durable generation fence, not the process-local maintenance queue.

- Source-table triggers advance `db_meta.quota_combo_generation` in the source writer's transaction.
- `syncQuotaCombos` builds the complete `qtSd/` projection from uncached SQLite pool/group/provider metadata. Shared group slugs merge and deduplicate connections; group moves, renames, provider changes, and deletions prune obsolete managed names without touching ordinary combos.
- `applyQuotaComboReconciliation` takes SQLite's immediate write lock **before** comparing the generation. A mismatch rejects the entire batch; success atomically commits all upserts, pruning, and the reconciled-generation marker. Exceptions roll back the batch.
- Cleanup uses the same reconciliation path. Captured deletion metadata cannot authorize a late unfenced delete.
- Facade combo reads recover an unreconciled generation (including a writer exiting before maintenance). Nested-routing and model-catalog cache entry points check recovery before serving cached results. Observing another process's reconciled generation invalidates local combo/catalog caches.

## Verification

Run only the isolated runner, which installs scratch `HOME`, `DATA_DIR`, and temporary paths before module imports:

```sh
cd apps/server
PATH="$HOME/.bun/bin:$PATH" "$HOME/.bun/bin/bun" scripts/test-isolated.ts \
  tests/quota-combo-cross-process-race-regression.test.ts \
  tests/quota-combo-generation-regression.test.ts \
  tests/quota-combo-read-recovery-regression.test.ts \
  tests/quota-combo-generation-typecheck.test.ts
```

The cross-process race test uses explicit ready/release barriers. Parent membership writes bypass maintenance hooks, eliminating delayed workers and fixed drain sleeps. It inspects raw durable combo rows after the stale child exits, so read-through recovery cannot hide a stale write.

Additional tests cover uncached provider metadata, stale-batch rejection, rollback, group moves, missing pools, user-combo preservation, facade read recovery, nested-routing cache recovery, and an already-primed catalog cache after a separate process both mutates and reconciles.

## Deployment boundary

This change requires the generation migration. Migration numbering is coordinated separately: the shared workspace currently names it `178_quota_combo_generation.sql`, after additive quota migrations 176/177. This task did not edit migration files or production state. Do not reuse occupied historical ledger versions or deploy runtime changes before the coordinated migrations.

The guarantees apply to the updated sync/cleanup/read paths. Old binaries performing unfenced direct combo writes are not retroactively made safe; drain old workers during deployment. Runtime model-registry changes are not database source mutations. Native Bun SQLite cross-process behavior is tested; sql.js file-backed multi-process operation remains unsupported by that adapter's separate fail-closed policy. General manual-combo cross-process cache invalidation is outside this quota-source generation fence.

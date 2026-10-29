import { expect, test } from "bun:test";
import { getDbInstance } from "../src/lib/db/core";
import { createProviderConnection } from "../src/lib/db/providers";
import { createPool, updatePool } from "../src/lib/db/quotaPools";
import { createGroup } from "../src/lib/db/quotaGroups";
import { getCachedProviderConnectionById } from "../src/lib/db/readCache";
import { getCombos } from "../src/lib/db/combos";
import { syncQuotaCombos } from "../src/lib/quota/quotaCombos";
import { applyQuotaComboReconciliation } from "../src/lib/db/quotaComboReconciliation";
import { getQuotaComboGeneration } from "../src/lib/db/quotaComboGeneration";

// All environment paths are installed by scripts/test-isolated.ts before imports.
test("sync uses authoritative provider metadata, not a cache primed before another writer", async () => {
  const connection = await createProviderConnection({ provider: "openai", authType: "apikey", apiKey: "test", name: "provider-change" });
  const group = createGroup("provider-change");
  const pool = createPool({ connectionId: connection.id, groupId: group.id, name: "provider-change" });
  await syncQuotaCombos(pool.id);
  expect((await getCachedProviderConnectionById(connection.id))?.provider).toBe("openai");
  // Raw SQL models a writer in a separate process: no local cache invalidation.
  getDbInstance().prepare("UPDATE provider_connections SET provider = 'anthropic' WHERE id = ?").run(connection.id);
  await syncQuotaCombos(pool.id);
  const combos = (await getCombos()).filter(combo => String(combo.name).startsWith("qtSd/providerchange/"));
  expect(combos.length).toBeGreaterThan(0);
  expect(combos.every(combo => String(combo.name).includes("/anthropic/"))).toBe(true);
  expect(combos.every(combo => (combo.models as any[]).every(step => step.providerId === "anthropic"))).toBe(true);
});

test("a failed reconciliation rolls back all upserts and pruning", async () => {
  const db = getDbInstance();
  const generation = getQuotaComboGeneration();
  db.exec("CREATE TRIGGER fail_quota_combo_insert BEFORE INSERT ON combos WHEN NEW.name = 'qtSd/rollback/openai/fail' BEGIN SELECT RAISE(ABORT, 'injected combo failure'); END");
  const write = (name: string) => ({ name, models: [{ kind: "model" as const, model: "openai/test", providerId: "openai", connectionId: "test", weight: 100 }], strategy: "quota-share", isHidden: true as const });
  try {
    expect(applyQuotaComboReconciliation(generation, [write("qtSd/rollback/openai/keep")], [])).toBe(true);
    const previousMarker = db.prepare("SELECT value FROM db_meta WHERE key = 'quota_combo_reconciled_generation'").get();
    expect(() => applyQuotaComboReconciliation(generation, [write("qtSd/rollback/openai/ok"), write("qtSd/rollback/openai/fail")], ["qtSd/rollback/openai/keep"])).toThrow("injected combo failure");
    expect(db.prepare("SELECT id FROM combos WHERE name = 'qtSd/rollback/openai/ok'").get()).toBeUndefined();
    expect(db.prepare("SELECT id FROM combos WHERE name = 'qtSd/rollback/openai/keep'").get()).toBeDefined();
    expect(db.prepare("SELECT value FROM db_meta WHERE key = 'quota_combo_reconciled_generation'").get()).toEqual(previousMarker);
  } finally {
    db.exec("DROP TRIGGER fail_quota_combo_insert");
  }
});

test("stale generation rejects the entire write batch", async () => {
  const generation = getQuotaComboGeneration();
  createGroup("advance-generation");
  // Pool source writes always advance the durable fence, including raw writers.
  getDbInstance().prepare("UPDATE quota_pools SET name = name").run();
  expect(getQuotaComboGeneration()).toBeGreaterThan(generation);
  expect(applyQuotaComboReconciliation(generation, [{ name: "qtSd/stale/openai/test", models: [], strategy: "quota-share", isHidden: true }], [])).toBe(false);
  expect(getDbInstance().prepare("SELECT id FROM combos WHERE name = 'qtSd/stale/openai/test'").get()).toBeUndefined();
});

test("group moves and deleted pools reconcile the whole projection without touching user combos", async () => {
  const connection = await createProviderConnection({ provider: "openai", authType: "apikey", apiKey: "test", name: "move" });
  const from = createGroup("Move From"), to = createGroup("Move To");
  const pool = createPool({ connectionId: connection.id, groupId: from.id, name: "move" });
  await syncQuotaCombos(pool.id);
  updatePool(pool.id, { groupId: to.id });
  await syncQuotaCombos(pool.id);
  const names = (await getCombos()).map(c => String(c.name));
  expect(names.some(name => name.startsWith("qtSd/movefrom/"))).toBe(false);
  expect(names.some(name => name.startsWith("qtSd/moveto/"))).toBe(true);
  const db = getDbInstance();
  db.prepare("INSERT INTO combos (id, name, data, created_at, updated_at) VALUES ('ordinary', 'ordinary', ?, datetime('now'), datetime('now'))").run(JSON.stringify({ id: "ordinary", name: "ordinary", models: [], strategy: "priority" }));
  db.immediate(() => {
    db.prepare("DELETE FROM quota_pool_connections WHERE pool_id = ?").run(pool.id);
    db.prepare("DELETE FROM quota_pools WHERE id = ?").run(pool.id);
  });
  await syncQuotaCombos(pool.id);
  expect((await getCombos()).some(c => String(c.name).startsWith("qtSd/moveto/"))).toBe(false);
  expect(db.prepare("SELECT id FROM combos WHERE name = 'ordinary'").get()).toBeDefined();
});


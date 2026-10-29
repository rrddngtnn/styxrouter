import { expect, spyOn, test } from "bun:test";
import * as reconciliation from "../src/lib/db/quotaComboReconciliation";
import { getDbInstance } from "../src/lib/db/core";
import { createProviderConnection } from "../src/lib/db/providers";
import { getComboById, getComboByName, getComboByNameInsensitive, getCombos } from "../src/lib/db/combos";
import { getQuotaComboGeneration } from "../src/lib/db/quotaComboGeneration";
import { syncQuotaCombos } from "../src/lib/quota/quotaCombos";

// Only raw source mutations: queued CRUD workers must not repair the fixture.
async function seedPool() {
  const connection = await createProviderConnection({ provider: "openai", authType: "apikey", apiKey: "test", name: "corrupt-json" });
  const db = getDbInstance();
  const poolId = crypto.randomUUID();
  db.immediate(() => {
    db.prepare("INSERT INTO quota_pools (id, connection_id, name, group_id, created_at, exclusive) VALUES (?, ?, 'corrupt-json', 'group-demo', ?, 0)").run(poolId, connection.id, new Date().toISOString());
    db.prepare("INSERT INTO quota_pool_connections (pool_id, connection_id) VALUES (?, ?)").run(poolId, connection.id);
  });
  await syncQuotaCombos(poolId);
  const managed = db.prepare("SELECT id, name, sort_order, created_at FROM combos WHERE name LIKE 'qtSd/%' LIMIT 1").get() as { id: string; name: string; sort_order: number; created_at: string };
  expect(managed).toBeDefined();
  return { db, poolId, connection, managed };
}

function insertUserCombo(name: string, data: string) {
  const id = crypto.randomUUID();
  getDbInstance().prepare("INSERT INTO combos (id, name, data, sort_order, created_at, updated_at) VALUES (?, ?, ?, 42, 'original-created', 'original-updated')").run(id, name, data);
  return id;
}

test("read recovery repairs corrupt desired JSON and prunes corrupt orphans without changing a user combo", async () => {
  const { db, poolId, connection, managed } = await seedPool();
  const userId = insertUserCombo("ordinary-preserved", JSON.stringify({ name: "ordinary-preserved", models: [], strategy: "priority", config: { custom: true } }));
  const userBefore = db.prepare("SELECT * FROM combos WHERE id = ?").get(userId);
  db.immediate(() => {
    db.prepare("UPDATE combos SET data = '{broken desired', context_cache_protection = 1 WHERE id = ?").run(managed.id);
    db.prepare("INSERT INTO combos (id, name, data, created_at, updated_at) VALUES ('corrupt-orphan', 'qtSd/orphan/openai/obsolete', '{broken orphan', 'old', 'old')").run();
    db.prepare("UPDATE quota_pools SET name = name WHERE id = ?").run(poolId);
  });

  // Even a normal user lookup must first recover the managed projection.
  expect((await getComboByName("ordinary-preserved"))?.name).toBe("ordinary-preserved");
  const row = db.prepare("SELECT * FROM combos WHERE id = ?").get(managed.id) as Record<string, unknown> & { data: string };
  expect(row).toMatchObject(managed);
  expect(row.context_cache_protection).toBe(0);
  const repaired = JSON.parse(row.data);
  expect(repaired).toMatchObject({ id: managed.id, name: managed.name, strategy: "quota-share", isHidden: true, quotaComboGeneration: getQuotaComboGeneration(), sortOrder: managed.sort_order, createdAt: managed.created_at });
  expect(repaired.models).toEqual(expect.arrayContaining([expect.objectContaining({ connectionId: connection.id })]));
  expect(db.prepare("SELECT id FROM combos WHERE id = 'corrupt-orphan'").get()).toBeUndefined();
  expect(db.prepare("SELECT * FROM combos WHERE id = ?").get(userId)).toEqual(userBefore);
  expect((await getComboById(managed.id))?.name).toBe(managed.name);
  expect((await getComboByNameInsensitive(managed.name.toUpperCase()))?.name).toBe(managed.name);
  expect((await getCombos()).some(combo => combo.id === managed.id)).toBe(true);
});

test("corrupt unrelated user JSON does not block reconciliation or unrelated lookups, but remains an explicit read error", async () => {
  const { db, poolId, managed } = await seedPool();
  const corruptId = insertUserCombo("ordinary-corrupt", "{broken user JSON");
  const before = db.prepare("SELECT * FROM combos WHERE id = ?").get(corruptId);
  try {
    db.prepare("UPDATE quota_pools SET name = name WHERE id = ?").run(poolId);
    expect((await getComboByName(managed.name))?.id).toBe(managed.id);
    expect(db.prepare("SELECT * FROM combos WHERE id = ?").get(corruptId)).toEqual(before);
    await expect(getComboByName("ordinary-corrupt")).rejects.toBeInstanceOf(SyntaxError);
    await expect(getComboById(corruptId)).rejects.toBeInstanceOf(SyntaxError);
    await expect(getCombos()).rejects.toBeInstanceOf(SyntaxError);
  } finally {
    db.prepare("DELETE FROM combos WHERE id = ?").run(corruptId);
  }
});

test("failed raw-name preparation does not modify any projection row or its marker", async () => {
  const { db, poolId } = await seedPool();
  db.prepare("UPDATE quota_pools SET name = name WHERE id = ?").run(poolId);
  const before = db.prepare("SELECT * FROM combos ORDER BY id").all();
  const marker = db.prepare("SELECT value FROM db_meta WHERE key = 'quota_combo_reconciled_generation'").get();
  const preparation = spyOn(reconciliation, "listQuotaComboNames").mockRejectedValue(new Error("injected name snapshot failure"));
  try {
    await expect(syncQuotaCombos(poolId)).rejects.toThrow("injected name snapshot failure");
    expect(db.prepare("SELECT * FROM combos ORDER BY id").all()).toEqual(before);
    expect(db.prepare("SELECT value FROM db_meta WHERE key = 'quota_combo_reconciled_generation'").get()).toEqual(marker);
  } finally {
    preparation.mockRestore();
  }
});

test("repair and corrupt-orphan pruning roll back atomically on write failure", async () => {
  const { db, poolId, managed } = await seedPool();
  db.prepare("UPDATE combos SET data = '{corrupt rollback' WHERE id = ?").run(managed.id);
  db.prepare("INSERT INTO combos (id, name, data, created_at, updated_at) VALUES ('rollback-orphan', 'qtSd/rollback/openai/obsolete', '{corrupt orphan', 'old', 'old')").run();
  db.prepare("UPDATE quota_pools SET name = name WHERE id = ?").run(poolId);
  const before = db.prepare("SELECT * FROM combos ORDER BY id").all();
  const marker = db.prepare("SELECT value FROM db_meta WHERE key = 'quota_combo_reconciled_generation'").get();
  db.exec("CREATE TRIGGER reject_corrupt_orphan_delete BEFORE DELETE ON combos WHEN OLD.id = 'rollback-orphan' BEGIN SELECT RAISE(ABORT, 'injected orphan prune failure'); END");
  try {
    await expect(syncQuotaCombos(poolId)).rejects.toThrow("injected orphan prune failure");
    expect(db.prepare("SELECT * FROM combos ORDER BY id").all()).toEqual(before);
    expect(db.prepare("SELECT value FROM db_meta WHERE key = 'quota_combo_reconciled_generation'").get()).toEqual(marker);
  } finally {
    db.exec("DROP TRIGGER reject_corrupt_orphan_delete");
  }
  await syncQuotaCombos(poolId);
  expect(() => JSON.parse((db.prepare("SELECT data FROM combos WHERE id = ?").get(managed.id) as { data: string }).data)).not.toThrow();
  expect(db.prepare("SELECT id FROM combos WHERE id = 'rollback-orphan'").get()).toBeUndefined();
});

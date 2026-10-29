import { expect, test } from "bun:test";
import { createProviderConnection } from "../src/lib/db/providers";
import { createPool, getPool } from "../src/lib/db/quotaPools";
import { getDbInstance } from "../src/lib/db/core";
import { resolveQuotaKeyScope } from "../src/lib/quota/quotaKey";
import { syncQuotaCombos, removeQuotaCombosForPool } from "../src/lib/quota/quotaCombos";
import { getCombos } from "../src/lib/db/combos";

test("reserved deny marker never resolves as a pool id", async () => {
  const conn = await createProviderConnection({ provider: "openai", authType: "apikey", apiKey: "x", name: "marker" } as any);
  const pool = createPool({ connectionId: conn.id, name: "marker" });
  const db = getDbInstance();
  // Emulate a legacy collision created before the reserved-ID trigger existed.
  db.prepare("DROP TRIGGER quota_pool_reserved_id_update").run();
  db.prepare("UPDATE quota_pool_connections SET pool_id = ? WHERE pool_id = ?").run("__quota_access_revoked__", pool.id);
  db.prepare("UPDATE quota_pools SET id = ? WHERE id = ?").run("__quota_access_revoked__", pool.id);
  expect(getPool("__quota_access_revoked__")).not.toBeNull();
  expect(await resolveQuotaKeyScope(["__quota_access_revoked__"])).toEqual({ connectionIds: [], providers: [], poolSlugs: [] });
});

test("removing a pool does not delete same-provider sibling combos", async () => {
  const a = await createProviderConnection({ provider: "openai", authType: "apikey", apiKey: "a", name: "a" } as any);
  const b = await createProviderConnection({ provider: "openai", authType: "apikey", apiKey: "b", name: "b" } as any);
  const p = createPool({ connectionId: a.id, name: "a" });
  const sibling = createPool({ connectionId: b.id, name: "b" });
  await syncQuotaCombos(sibling.id);
  const before = (await getCombos()).filter(c => String(c.name).startsWith("qtSd/"));
  expect(before.length).toBeGreaterThan(0);
  await removeQuotaCombosForPool(p.id);
  const after = (await getCombos()).filter(c => String(c.name).startsWith("qtSd/"));
  expect(after.map(c => c.name).sort()).toEqual(before.map(c => c.name).sort());
});

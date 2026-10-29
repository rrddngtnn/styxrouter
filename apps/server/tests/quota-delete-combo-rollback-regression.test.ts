import { expect, test } from "bun:test";
import { createApiKey } from "../src/lib/db/apiKeys";
import { createProviderConnection } from "../src/lib/db/providers";
import { createPool, deletePool, getPool } from "../src/lib/db/quotaPools";
import { getDbInstance } from "../src/lib/db/core";
import { syncQuotaCombos } from "../src/lib/quota/quotaCombos";
import { getCombos } from "../src/lib/db/combos";

test("failed pool deletion leaves its managed combos unchanged", async () => {
  const key = await createApiKey("rollback", "test");
  const conn = await createProviderConnection({ provider: "openai", authType: "apikey", apiKey: "test", name: "rollback" } as any);
  const pool = createPool({ connectionId: conn.id, name: "rollback", exclusive: true, allocations: [{ apiKeyId: key.id, weight: 100, policy: "hard" }] });
  await syncQuotaCombos(pool.id);
  const before = (await getCombos()).filter(c => String(c.name).startsWith("qtSd/"));
  expect(before.length).toBeGreaterThan(0);
  const db = getDbInstance();
  db.prepare("CREATE TRIGGER quota_delete_failure BEFORE DELETE ON quota_pools BEGIN SELECT RAISE(ABORT, 'injected delete failure'); END").run();
  await expect(deletePool(pool.id)).rejects.toThrow("injected delete failure");
  expect(getPool(pool.id)).not.toBeNull();
  expect((await getCombos()).filter(c => String(c.name).startsWith("qtSd/")).map(c => c.name).sort()).toEqual(before.map(c => c.name).sort());
});

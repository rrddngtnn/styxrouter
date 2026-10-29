import { expect, test } from "bun:test";
import { createApiKey, getApiKeyById } from "../src/lib/db/apiKeys";
import { createProviderConnection } from "../src/lib/db/providers";
import { createPool, updatePool, deletePool } from "../src/lib/db/quotaPools";
import { getDbInstance } from "../src/lib/db/core";
import { validateApiKeyRoutingTarget } from "../src/shared/utils/apiKeyPolicy";

test("exclusive lifecycle is atomic and preserves competing pool permissions", async () => {
  const key = await createApiKey("atomic", "test");
  const conn = await createProviderConnection({ provider: "openai", authType: "apikey", apiKey: "dummy", name: "atomic" } as any);
  const allocation = [{ apiKeyId: key.id, weight: 100, policy: "hard" as const }];
  const first = createPool({ connectionId: conn.id, name: "first", allocations: allocation, exclusive: true } as any);
  const second = createPool({ connectionId: conn.id, name: "second", allocations: allocation, exclusive: true } as any);
  expect(new Set((await getApiKeyById(key.id))!.allowedQuotas)).toEqual(new Set([first.id, second.id]));
  const db = getDbInstance();
  db.prepare("CREATE TRIGGER quota_test_fail BEFORE UPDATE OF allowed_quotas ON api_keys BEGIN SELECT RAISE(ABORT, 'injected reconciliation failure'); END").run();
  expect(() => updatePool(first.id, { exclusive: false })).toThrow("injected reconciliation failure");
  expect((await import("../src/lib/db/quotaPools")).getPool(first.id)!.exclusive).toBe(true);
  db.prepare("DROP TRIGGER quota_test_fail").run();
  updatePool(first.id, { exclusive: false });
  expect((await getApiKeyById(key.id))!.allowedQuotas).toEqual([second.id]);
  await deletePool(second.id);
  const allowedQuotas = (await getApiKeyById(key.id))!.allowedQuotas;
  expect(allowedQuotas).toEqual(["__quota_access_revoked__"]);
  expect(await validateApiKeyRoutingTarget(new Request("http://localhost"), "key", { allowedQuotas } as any, "openai/gpt-4o")).not.toBeNull();
});

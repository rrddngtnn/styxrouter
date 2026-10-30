import "./helpers/test-secrets";
import { expect, test } from "bun:test";
import { createApiKey, getApiKeyById } from "../src/lib/db/apiKeys";
import { createProviderConnection } from "../src/lib/db/providers";
import { createPool, updatePool, deletePool } from "../src/lib/db/quotaPools";
import { validateApiKeyRoutingTarget } from "../src/shared/utils/apiKeyPolicy";

test("removing the last exclusive allocation cannot restore ordinary model access", async () => {
  const key = await createApiKey("revoked", "test");
  const conn = await createProviderConnection({ provider: "openai", authType: "apikey", apiKey: "test", name: "revoked" } as any);
  const pool = createPool({ connectionId: conn.id, name: "revoked", exclusive: true, allocations: [{ apiKeyId: key.id, weight: 100, policy: "hard" }] });
  updatePool(pool.id, { allocations: [] });
  const quotas = (await getApiKeyById(key.id))!.allowedQuotas;
  expect(quotas.length).toBeGreaterThan(0);
  expect(await validateApiKeyRoutingTarget(new Request("http://localhost"), "key", { allowedQuotas: quotas } as any, "openai/gpt-4o")).not.toBeNull();
  updatePool(pool.id, { allocations: [{ apiKeyId: key.id, weight: 100, policy: "hard" }] });
  expect((await getApiKeyById(key.id))!.allowedQuotas).toEqual([pool.id]);
});

test("deleting the last allowed pool cannot restore ordinary model access", async () => {
  const key = await createApiKey("deleted", "test");
  const conn = await createProviderConnection({ provider: "openai", authType: "apikey", apiKey: "test", name: "deleted" } as any);
  const pool = createPool({ connectionId: conn.id, name: "deleted", exclusive: true, allocations: [{ apiKeyId: key.id, weight: 100, policy: "hard" }] });
  expect(await deletePool(pool.id)).toBe(true);
  const quotas = (await getApiKeyById(key.id))!.allowedQuotas;
  expect(quotas.length).toBeGreaterThan(0);
  expect(await validateApiKeyRoutingTarget(new Request("http://localhost"), "key", { allowedQuotas: quotas } as any, "openai/gpt-4o")).not.toBeNull();
});

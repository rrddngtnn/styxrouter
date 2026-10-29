import { expect, test } from "bun:test";
import { SignJWT } from "jose";
import { Hono } from "hono";
import { requireAuth } from "../server/auth";
import { mountRoute } from "../server/routeMount";
import { createApiKey, getApiKeyById } from "../src/lib/db/apiKeys";
import { createProviderConnection } from "../src/lib/db/providers";
import { createPool } from "../src/lib/db/quotaPools";
import { validateApiKeyRoutingTarget } from "../src/shared/utils/apiKeyPolicy";

process.env.JWT_SECRET = "isolated-quota-lifecycle-secret";

test("allocation-only edits retain pool exclusivity through empty allocations and competing pools", async () => {
  const a = await createApiKey("quota-a", "test");
  const b = await createApiKey("quota-b", "test");
  const c = await createApiKey("quota-c", "test");
  const connection = await createProviderConnection({ provider: "openai", authType: "apikey", apiKey: "test", name: "quota" } as any);
  const pool = createPool({ connectionId: connection.id, name: "one", allocations: [{ apiKeyId: a.id, weight: 100, policy: "hard" }] });
  const other = createPool({ connectionId: connection.id, name: "two", allocations: [{ apiKeyId: a.id, weight: 100, policy: "hard" }] });
  const token = await new SignJWT({ authenticated: true }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("1h").sign(new TextEncoder().encode(process.env.JWT_SECRET));
  const app = new Hono();
  app.use("*", requireAuth);
  mountRoute(app, "/api/quota/pools/:id", () => import("../src/app/api/quota/pools/[id]/route"));
  const patch = async (id: string, body: object) => {
    const response = await app.request(`/api/quota/pools/${id}`, { method: "PATCH", headers: { cookie: `auth_token=${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    expect(response.status).toBe(200);
  };
  const allocations = (...ids: string[]) => ids.map(apiKeyId => ({ apiKeyId, weight: 100, policy: "hard" }));
  const quotas = async (id: string) => (await getApiKeyById(id))?.allowedQuotas ?? [];
  const expectRevoked = async (id: string) => {
    const allowedQuotas = await quotas(id);
    expect(allowedQuotas).toEqual(["__quota_access_revoked__"]);
    expect(await validateApiKeyRoutingTarget(new Request("http://localhost"), "key", { allowedQuotas } as any, "openai/gpt-4o")).not.toBeNull();
  };
  await patch(pool.id, { exclusive: true });
  await patch(other.id, { exclusive: true });
  await patch(pool.id, { allocations: allocations(b.id) });
  expect(await quotas(a.id)).toEqual([other.id]);
  expect(await quotas(b.id)).toEqual([pool.id]);
  await patch(pool.id, { allocations: [] });
  await expectRevoked(b.id);
  await patch(pool.id, { allocations: allocations(c.id) });
  expect(await quotas(c.id)).toEqual([pool.id]);
  await patch(pool.id, { exclusive: false });
  await expectRevoked(c.id);
  await patch(pool.id, { allocations: allocations(a.id) });
  expect(await quotas(a.id)).toEqual([other.id]);
  await patch(pool.id, { allocations: [], exclusive: true });
  await patch(pool.id, { allocations: allocations(a.id) });
  expect(new Set(await quotas(a.id))).toEqual(new Set([other.id, pool.id]));
  const response = await app.request(`/api/quota/pools/${pool.id}`, { method: "DELETE", headers: { cookie: `auth_token=${token}` } });
  expect(response.status).toBe(204);
  expect(await quotas(a.id)).toEqual([other.id]);
});

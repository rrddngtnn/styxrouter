import "./helpers/test-secrets";
import { expect, test } from "bun:test";
import { SignJWT } from "jose";
import { Hono } from "hono";
import { requireAuth } from "../server/auth";
import { mountRoute } from "../server/routeMount";
import { createApiKey, getApiKeyById } from "../src/lib/db/apiKeys";
import { createProviderConnection } from "../src/lib/db/providers";
import { createPool } from "../src/lib/db/quotaPools";

process.env.JWT_SECRET = "isolated-quota-test-secret";

test("enabling exclusivity without replacing allocations scopes existing keys", async () => {
  const key = await createApiKey("quota-exclusive", "test-machine");
  const connection = await createProviderConnection({ provider: "openai", authType: "apikey", apiKey: "test-only", name: "quota" } as any);
  const pool = createPool({ connectionId: connection.id, name: "quota", allocations: [{ apiKeyId: key.id, weight: 100, policy: "hard" }] });
  const token = await new SignJWT({ authenticated: true }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("1h").sign(new TextEncoder().encode(process.env.JWT_SECRET));
  const app = new Hono();
  app.use("*", requireAuth);
  mountRoute(app, "/api/quota/pools/:id", () => import("../src/app/api/quota/pools/[id]/route"));
  const response = await app.request(`/api/quota/pools/${pool.id}`, { method: "PATCH", headers: { cookie: `auth_token=${token}`, "content-type": "application/json" }, body: JSON.stringify({ exclusive: true }) });
  expect(response.status).toBe(200);
  expect((await getApiKeyById(key.id))?.allowedQuotas).toContain(pool.id);
});

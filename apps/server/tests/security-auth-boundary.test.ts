import { expect, test } from "bun:test";
import { Hono } from "hono";

test("authentication and policy interpret bearer whitespace consistently", async () => {
  process.env.API_KEY_SECRET = "synthetic-security-boundary-test-secret";
  const { createApiKey, updateApiKeyPermissions } = await import("../src/lib/db/apiKeys.ts");
  const { enforceApiKeyPolicy } = await import("../src/shared/utils/apiKeyPolicy.ts");
  const { requireAuth } = await import("../server/auth.ts");
  const created = await createApiKey("security-test", "test-machine");
  await updateApiKeyPermissions(created.id, { allowedEndpoints: ["models"] });
  const app = new Hono();
  app.use("*", requireAuth);
  app.post("/v1/chat/completions", async (c) => {
    const policy = await enforceApiKeyPolicy(c.req.raw, null);
    return policy.rejection ?? c.json({ ok: true });
  });
  for (const separator of [" ", "\t"]) {
    const response = await app.request("/v1/chat/completions", {
      method: "POST", headers: { authorization: `Bearer${separator}${created.key}` },
    });
    expect(response.status).toBe(separator === " " ? 403 : 401);
  }
});

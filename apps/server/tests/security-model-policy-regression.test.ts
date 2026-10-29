import { expect, test } from "bun:test";
import { Hono } from "hono";

process.env.API_KEY_SECRET = "synthetic-security-model-policy-test-secret";
const { createApiKey, updateApiKeyPermissions } = await import("../src/lib/db/apiKeys.ts");
const { requireAuth } = await import("../server/auth.ts");
const { enforceApiKeyPolicy } = await import("../src/shared/utils/apiKeyPolicy.ts");

test("models endpoint enforces an API key's endpoint restriction", async () => {
  const key = await createApiKey("models-policy", "test-machine");
  await updateApiKeyPermissions(key.id, { allowedEndpoints: ["chat"] });
  const app = new Hono();
  app.use("*", requireAuth);
  app.get("/v1/models", c => c.json({ data: [] }));
  const response = await app.request("/v1/models", { headers: { authorization: `Bearer ${key.key}` } });
  expect(response.status).toBe(403);
});

test("invalid schedule timezone denies rather than bypassing access hours", async () => {
  const key = await createApiKey("invalid-schedule", "test-machine");
  await updateApiKeyPermissions(key.id, { accessSchedule: { enabled: true, from: "09:00", until: "17:00", days: [0,1,2,3,4,5,6], tz: "Invalid/Timezone" } });
  const request = new Request("http://localhost/v1/chat/completions", { headers: { authorization: `Bearer ${key.key}` } });
  const result = await enforceApiKeyPolicy(request, null);
  expect(result.rejection?.status).toBe(403);
});

import { expect, test } from "bun:test";
import { createApiKey, validateApiKey } from "../src/lib/db/apiKeys.ts";
import { getDbInstance } from "../src/lib/db/core.ts";
import { enforceApiKeyPolicy } from "../src/shared/utils/apiKeyPolicy.ts";

test("malformed stored API key expiry fails closed at authentication and policy", async () => {
  process.env.API_KEY_SECRET = "isolated-regression-secret-0123456789abcdef";
  const key = await createApiKey("malformed-expiry", "test-machine");
  getDbInstance().prepare("UPDATE api_keys SET expires_at = ? WHERE id = ?").run("not-a-date", key.id);
  expect(await validateApiKey(key.key)).toBe(false);
  const request = new Request("http://localhost/v1/chat/completions", { headers: { authorization: `Bearer ${key.key}` } });
  expect((await enforceApiKeyPolicy(request, null)).rejection?.status).toBe(403);
});

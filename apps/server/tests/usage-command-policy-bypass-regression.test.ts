import { expect, test } from "bun:test";
import { createApiKey, updateApiKeyPermissions } from "../src/lib/db/apiKeys.ts";
import { handleChat } from "../src/sse/handlers/chat.ts";
import { POST as countTokens } from "../src/app/api/v1/messages/count_tokens/route.ts";
import { requireAuth } from "../server/auth.ts";
import { createV1Api } from "../server/v1.ts";
import { Hono } from "hono";

test("usage command cannot bypass chat endpoint restrictions", async () => {
  const key = await createApiKey("usage-command-policy", "test-machine");
  await updateApiKeyPermissions(key.id, { allowedEndpoints: ["models"], allowUsageCommand: true });
  const body = { model: "openai/gpt-4o", messages: [{ role: "user", content: "@@om-usage" }] };
  const request = new Request("http://localhost/v1/chat/completions", {
    method: "POST", headers: { authorization: `Bearer ${key.key}`, "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const response = await handleChat(request as any, null, body);
  expect(response.status).toBe(403);
});

test("all mounted v1 inference routes enforce endpoint policy", async () => {
  const key = await createApiKey("route-coverage", "test-machine");
  await updateApiKeyPermissions(key.id, { allowedEndpoints: ["models"] });
  const app = new Hono();
  app.use("*", requireAuth);
  app.route("/v1", createV1Api(async () => {}));
  app.post("/v1/chat/completions", async c => handleChat(c.req.raw as any, null, await c.req.json()));
  const body = { model: "openai/gpt-4o", messages: [{ role: "user", content: "hello" }] };
  for (const path of ["/v1/chat/completions", "/v1/messages", "/v1/responses", "/v1/messages/count_tokens"]) {
    const response = await app.request(path, { method: "POST", headers: { authorization: `Bearer ${key.key}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    expect([path, response.status]).toEqual([path, 403]);
  }
});

test("model-less count permits unrestricted keys and rejects restricted model requests", async () => {
  const key = await createApiKey("count-model", "test-machine");
  await updateApiKeyPermissions(key.id, { modelAccessMode: "restricted", allowedModels: ["openai/gpt-4o"] });
  const call = (model?: string) => countTokens(new Request("http://localhost/v1/messages/count_tokens", {
    method: "POST", headers: { authorization: `Bearer ${key.key}`, "content-type": "application/json" },
    body: JSON.stringify({ ...(model ? { model } : {}), messages: [{ role: "user", content: "hello" }] }),
  }));
  expect((await call()).status).toBe(200);
  expect((await call("openai/forbidden-model")).status).toBe(403);
});

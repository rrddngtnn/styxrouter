import { expect, test } from "bun:test";
import { createApiKey, updateApiKeyPermissions } from "../src/lib/db/apiKeys.ts";
import { POST } from "../src/app/api/v1/messages/count_tokens/route.ts";

test("model-less token counting enforces endpoint restrictions", async () => {
  const key = await createApiKey("count-restricted", "test-machine");
  await updateApiKeyPermissions(key.id, { allowedEndpoints: ["models"] });
  const response = await POST(new Request("http://localhost/v1/messages/count_tokens", {
    method: "POST",
    headers: { authorization: `Bearer ${key.key}`, "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
  }));
  expect(response.status).toBe(403);
});

import { expect, test } from "bun:test";
import { PromptQlExecutor } from "../open-sse/executors/promptql.ts";

test("GraphQL authentication rejection does not retry roomless or leak the upstream error", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return Response.json({ errors: [{ message: "unauthorized synthetic-secret", extensions: { code: "invalid-jwt" } }] }); }) as typeof fetch;
  try {
    const result = await new PromptQlExecutor().execute({ model: "bedrock-claude-sonnet-4-5", body: { messages: [{ role: "user", content: "hello" }] }, stream: false, credentials: { accessToken: "synthetic-secret", providerSpecificData: { importedToken: true, nonRefreshable: true, projectId: "12345678-1234-4123-8123-123456789012" } } } as any);
    expect(result.response.status).toBe(401);
    expect(calls).toBe(1);
    expect(await result.response.text()).not.toContain("synthetic-secret");
  } finally { globalThis.fetch = original; }
});

import { expect, test } from "bun:test";

test("HTTP routed chaos, context pin and nested execute enforce tags", async () => {
  // Synthetic fixture; initialize auth only after the isolated test secret is set.
  process.env.API_KEY_SECRET = "synthetic-combo-prelude-test-secret";
  const { createProviderConnection, createProviderNode } = await import("../src/lib/db/providers");
  const { createApiKey } = await import("../src/lib/db/apiKeys");
  const { createCombo } = await import("../src/lib/db/combos");
  const { initTranslators } = await import("../open-sse/translator/index");
  const { handleChat } = await import("../src/sse/handlers/chat");
  const { recordSessionModelUsage } = await import("../src/lib/db/contextHandoffs");
  const { deriveComboSessionKey } = await import("../open-sse/services/combo/autoStrategy");
  await initTranslators();
  const node: any = await createProviderNode({ type: "openai-compatible", name: "tag-prelude-http", prefix: "tagpreludehttp", apiType: "chat", baseUrl: "https://tag-prelude.invalid/v1" });
  await createProviderConnection({ provider: node.id, authType: "apikey", name: "red-http", apiKey: "fixture", providerSpecificData: { tags: ["red"] } } as any);
  const model = `${node.id}/fixture-model`;
  const child: any = await createCombo({ name: "tag-http-child", strategy: "priority", models: [model] } as any);
  for (const mode of ["chaos", "pin", "nested"]) {
    await createCombo({ name: `tag-http-${mode}`, strategy: "priority", models: mode === "nested" ? [model, { kind: "combo-ref", comboName: child.name }] : [model], config: { maxRetries: 0, ...(mode === "chaos" ? { chaos: { enabled: true } } : {}), ...(mode === "nested" ? { nestedComboMode: "execute" } : {}) }, context_cache_protection: mode === "pin" } as any);
  }
  const key = await createApiKey("tag-http-key", "test");
  const original = globalThis.fetch;
  const sent: string[] = [];
  globalThis.fetch = (async (url: any, options: any) => {
    if (String(url).startsWith("http://127.0.0.1:")) return original(url, options);
    sent.push(String(url));
    return Response.json({ id: "fixture", object: "chat.completion", model: "fixture-model", choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
  }) as typeof fetch;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handleChat });
  try {
    for (const mode of ["chaos", "pin", "nested"]) {
      const requestBody = { model: `tag-http-${mode}`, messages: [{ role: "user", content: "hi" }], stream: false, metadata: { tags: ["blue"] } };
      if (mode === "pin") {
        const session = deriveComboSessionKey(requestBody);
        if (!session) throw new Error("fixture did not derive a session");
        recordSessionModelUsage(session, requestBody.model, model, node.id);
      }
      sent.length = 0;
      const result = await original(`http://127.0.0.1:${server.port}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key.key}` }, body: JSON.stringify(requestBody) });
      await result.text();
      expect({ mode, sent }).toEqual({ mode, sent: [] });
      expect(result.status).not.toBe(200);
    }
  } finally { server.stop(true); globalThis.fetch = original; }
}, 60000);

import "./helpers/test-secrets";
import { expect, test, spyOn } from "bun:test";
import { createProviderConnection, createProviderNode } from "../src/lib/db/providers";
import { createApiKey } from "../src/lib/db/apiKeys";
import { createCombo } from "../src/lib/db/combos";
import { initTranslators } from "../open-sse/translator/index";
import * as strategy from "../open-sse/services/combo/autoStrategy";
import { handleChat } from "../src/sse/handlers/chat";

test("a tag removed after combo eligibility must not dispatch that credential", async () => {
  await initTranslators();
  const node: any = await createProviderNode({ type: "openai-compatible", name: "race-tag", prefix: "racetag", apiType: "chat", baseUrl: "https://race-tag.invalid/v1" });
  const account = await createProviderConnection({ provider: node.id, authType: "apikey", name: "race", apiKey: "fixture-key", providerSpecificData: { tags: ["blue"] } } as any);
  await createCombo({ name: "tag-race-combo", strategy: "priority", models: [`${node.id}/fixture-model`], config: { maxRetries: 0 } } as any);
  const key = await createApiKey("race-tag-key", "test");
  const original = strategy.applyRequestTagRouting;
  let raced = false;
  const spy = spyOn(strategy, "applyRequestTagRouting").mockImplementation(async (...args) => {
    const eligible = await original(...args);
    if (!raced && eligible.length) {
      raced = true;
      const child = Bun.spawn([process.execPath, "-e", `const { getDbInstance } = await import('./src/lib/db/core'); const db = getDbInstance(); db.prepare("UPDATE provider_connections SET provider_specific_data = ? WHERE id = ?").run(JSON.stringify({tags:['red']}), process.argv[1]);`, account.id], { cwd: process.cwd(), env: process.env, stdout: "pipe", stderr: "pipe" });
      const code = await child.exited;
      if (code !== 0) throw new Error(await new Response(child.stderr).text());
    }
    return eligible;
  });
  const fetchOriginal = globalThis.fetch;
  let sent = 0;
  globalThis.fetch = (async (url: any, options: any) => {
    if (String(url).startsWith("http://127.0.0.1:")) return fetchOriginal(url, options);
    sent++;
    return Response.json({ id: "fixture", object: "chat.completion", model: "fixture-model", choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
  }) as typeof fetch;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handleChat });
  try {
    const response = await fetchOriginal(`http://127.0.0.1:${server.port}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key.key}` }, body: JSON.stringify({ model: "tag-race-combo", messages: [{ role: "user", content: "hi" }], stream: false, metadata: { tags: ["blue"] } }) });
    await response.text();
    expect(raced).toBe(true);
    expect(sent).toBe(0);
    expect(response.status).not.toBe(200);
  } finally { server.stop(true); globalThis.fetch = fetchOriginal; spy.mockRestore(); }
}, 60000);

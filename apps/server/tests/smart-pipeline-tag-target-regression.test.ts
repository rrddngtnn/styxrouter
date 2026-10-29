import { expect, test } from "bun:test";
import { createApiKey } from "../src/lib/db/apiKeys";
import { createProviderNode, createProviderConnection } from "../src/lib/db/providers";
import { createCombo } from "../src/lib/db/combos";
import { initTranslators } from "../open-sse/translator/index";
import { handleChat } from "../src/sse/handlers/chat";
import { handlePipelineCombo } from "../open-sse/services/autoCombo/pipelineRouter";

test("pipeline routes each stage through tagged targets and fails closed on no match", async () => {
  await initTranslators();
  const node: any = await createProviderNode({ type: "openai-compatible", name: "pipeline-tag-fixture", prefix: "pipelinetagfixture", apiType: "chat", baseUrl: "https://pipelinetagfixture.example/v1" });
  for (const [name, tags] of [["untagged", []], ["blue", ["blue"]]] as const) {
    await createProviderConnection({ provider: node.id, authType: "apikey", name, apiKey: `fixture-${name}`, isActive: true, providerSpecificData: { tags, baseUrl: "https://pipelinetagfixture.example/v1", apiType: "chat" } } as any);
  }
  await createCombo({ name: "pipeline-tag-combo", strategy: "auto", models: [`${node.id}/fixture-model`], config: { pipeline_enabled: true, skip_pipeline_for_tokens_under: 0, max_reflection_loops: 0 } } as any);
  const key = await createApiKey("pipeline-tag-key", "test");
  const sent: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: any, options: any) => {
    if (String(url).startsWith("http://127.0.0.1:")) return original(url, options);
    sent.push(new Headers(options.headers).get("authorization") || "");
    return Response.json({ id: "fixture", object: "chat.completion", model: "fixture-model", choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
  }) as typeof fetch;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handleChat });
  const request = (tags?: string[]) => original(`http://127.0.0.1:${server.port}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key.key}` }, body: JSON.stringify({ model: "pipeline-tag-combo", messages: [{ role: "user", content: "hi" }], stream: false, ...(tags ? { metadata: { tags } } : {}) }) });
  try {
    let response = await request(["blue"]);
    expect(response.status).toBe(200);
    await response.text();
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every((auth) => auth === "Bearer fixture-blue")).toBe(true);
    sent.length = 0;
    response = await request(["missing"]);
    expect(response.status).not.toBe(200);
    expect(sent).toEqual([]);
    sent.length = 0;
    response = await request();
    expect(response.status).toBe(200);
    expect(sent.length).toBeGreaterThan(0);
  } finally { server.stop(true); globalThis.fetch = original; }
}, 60000);

test("pipeline preserves the selected target across every fitness tier and duplicate model IDs", async () => {
  const target: any = { kind: "model", stepId: "one", executionKey: "one", modelStr: "openai/gpt-4o", provider: "openai", providerId: "openai", connectionId: "blue", allowedConnectionIds: ["blue"], weight: 1, label: null };
  const other = { ...target, stepId: "two", executionKey: "two", connectionId: "red", allowedConnectionIds: ["red"] };
  const seen: any[] = [];
  const log = { info() {}, warn() {}, error() {} };
  for (const prompt of ["hi", "Write a Python function to compute a sorted list and explain how the algorithm works", "Solve this mathematical proof with rigorous reasoning", "Write a creative story about a voyage"]) {
    await handlePipelineCombo({ body: { messages: [{ role: "user", content: prompt }] }, combo: { config: { pipeline_enabled: true, skip_pipeline_for_tokens_under: 0, max_reflection_loops: 0 } }, availableTargets: [target, other], settings: {}, log, handleChatCore: async (_body, model, selected) => { seen.push({ model, selected }); return Response.json({ choices: [{ message: { content: "PASS" } }] }); } });
  }
  expect(seen.length).toBeGreaterThan(4);
  for (const call of seen) { expect(call.model).toBe(target.modelStr); expect(call.selected).toBe(target); }
  await expect(handlePipelineCombo({ body: { messages: [] }, combo: { config: { pipeline_enabled: true, skip_pipeline_for_tokens_under: 0 } }, availableTargets: [], settings: {}, log, handleChatCore: async () => { throw new Error("must not dispatch"); } })).rejects.toThrow("PIPELINE_NO_MODELS");
});

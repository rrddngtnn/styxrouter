import { expect, test } from "bun:test";
import { createProviderNode, createProviderConnection } from "../src/lib/db/providers";
import { getDbInstance } from "../src/lib/db/core";
import { invalidateDbCache } from "../src/lib/db/readCache";
import { handleChat } from "../src/sse/handlers/chat";
import { getProviderPrefixIndex } from "../src/lib/providerNodePrefixes";
import { initTranslators } from "../open-sse/translator/index";
import { addCustomModel } from "../src/lib/db/models";

async function fixture(prefix: string, apiType: "chat" | "responses") {
  const node: any = await createProviderNode({ type: "openai-compatible", name: prefix, prefix, apiType, baseUrl: `https://${prefix}.example/v1` });
  await createProviderConnection({ provider: node.id, authType: "apikey", apiKey: `key-${prefix}`, name: prefix, isActive: true, providerSpecificData: { prefix, apiType, baseUrl: `https://${prefix}.example/v1` } } as any);
  return node;
}

test("UUID compatible nodes dispatch using configured chat and responses wire protocols", async () => {
  await initTranslators();
  const chat = await fixture("nodechatfixture", "chat");
  const responses = await fixture("noderesponsesfixture", "responses");
  const sent: any[] = [];
  const previous = globalThis.fetch;
  globalThis.fetch = (async (url, options) => {
    const body = JSON.parse(String(options?.body));
    sent.push({ url: String(url), body, authorization: new Headers(options?.headers).get("authorization") });
    if (String(url).endsWith("/responses")) return Response.json({ id: "r1", object: "response", status: "completed", model: body.model, output: [{ type: "message", id: "m1", role: "assistant", status: "completed", content: [{ type: "output_text", text: "ok", annotations: [] }] }], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } });
    return Response.json({ id: "c1", object: "chat.completion", model: body.model, choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
  }) as typeof fetch;
  try {
    for (const [node, alias, type] of [[chat, "nodechatfixture", "chat"], [responses, "noderesponsesfixture", "responses"]] as const) {
      for (const prefix of [alias, node.id]) {
       for (const endpoint of ["chat/completions", "responses"]) {
        const body = endpoint === "responses" ? { model: `${prefix}/vendor/model`, input: "hi", stream: false } : { model: `${prefix}/vendor/model`, messages: [{ role: "user", content: "hi" }], stream: false };
        const req = new Request(`http://localhost/v1/${endpoint}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        const result = await handleChat(req);
        expect([type, prefix, result.status, await result.text()]).toEqual([type, prefix, 200, expect.any(String)]);
        const outbound = sent.at(-1);
        expect(outbound.url).toBe(`https://${alias}.example/v1/${type === "chat" ? "chat/completions" : "responses"}`);
        expect(outbound.authorization).toBe(`Bearer key-${alias}`);
        expect(outbound.body.model).toBe("vendor/model");
        expect(type === "chat" ? outbound.body.messages : outbound.body.input).toBeDefined();
       }
      }
    }
  } finally { globalThis.fetch = previous; }
}, 60000);

test("manual compatible model dispatch retains its exact upstream identifier", async () => {
  await initTranslators();
  const node = await fixture("manualdispatchfixture", "chat");
  await addCustomModel(node.id, "vendor/manual-node", "Manual", "manual", "chat-completions", ["chat"], undefined, { inputTokenLimit: 4096, outputTokenLimit: 1024 }, true);
  const previous = globalThis.fetch;
  const sent: any[] = [];
  globalThis.fetch = (async (_url, options) => {
    const body = JSON.parse(String(options?.body)); sent.push(body);
    return Response.json({ id: "fixture", object: "chat.completion", model: body.model, choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
  }) as typeof fetch;
  try {
    for (const prefix of ["manualdispatchfixture", node.id]) {
      const request = new Request("http://localhost/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: `${prefix}/vendor/manual-node`, messages: [{ role: "user", content: "hi" }], max_tokens: 128, stream: false }) });
      const response = await handleChat(request);
      expect(response.status).toBe(200);
      expect(sent.at(-1).model).toBe("vendor/manual-node");
      expect(sent.at(-1).max_tokens).toBe(128);
    }
  } finally { globalThis.fetch = previous; }
}, 60000);

test("legacy duplicate aliases fail closed while exact node IDs remain usable", async () => {
  const first = await fixture("duplicatenodefixture", "chat");
  const second = await fixture("differentnodefixture", "chat");
  (getDbInstance() as any).prepare("UPDATE provider_nodes SET prefix = ? WHERE id = ?").run("duplicatenodefixture", second.id);
  invalidateDbCache("nodes");
  const index = await getProviderPrefixIndex();
  expect(index.entries.get("duplicatenodefixture")?.status).toBe("ambiguous");
  expect(index.prefixToNode.has("duplicatenodefixture")).toBe(false);
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return Response.json({ id: "c1", object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }] }); }) as typeof fetch;
  try {
    const req = (prefix: string) => new Request("http://localhost/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: `${prefix}/fixture-model`, messages: [{ role: "user", content: "hi" }], stream: false }) });
    expect((await handleChat(req("duplicatenodefixture"))).status).toBe(400);
    expect(calls).toBe(0);
    expect((await handleChat(req(first.id))).status).toBe(200);
    expect((await handleChat(req(second.id))).status).toBe(200);
    expect(calls).toBe(2);
  } finally { globalThis.fetch = previous; }
}, 60000);

test("UUID anthropic-compatible node dispatches to its configured messages endpoint", async () => {
  await initTranslators();
  const node: any = await createProviderNode({ type: "anthropic-compatible", name: "anthropicfixture", prefix: "anthropicfixture", baseUrl: "https://anthropicfixture.example/v1" });
  await createProviderConnection({ provider: node.id, authType: "apikey", apiKey: "fixture-anthropic-key", name: "anthropicfixture", isActive: true, providerSpecificData: { baseUrl: "https://anthropicfixture.example/v1" } } as any);
  const previous = globalThis.fetch;
  const sent: any[] = [];
  globalThis.fetch = (async (url, options) => {
    sent.push({ url: String(url), body: JSON.parse(String(options?.body)) });
    return Response.json({ id: "msg_fixture", type: "message", role: "assistant", model: "fixture-model", content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } });
  }) as typeof fetch;
  try {
    const req = new Request("http://localhost/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: `${node.id}/fixture-model`, messages: [{ role: "user", content: "hi" }], stream: false }) });
    const result = await handleChat(req);
    expect(result.status).toBe(200);
    expect(sent[0].url).toBe("https://anthropicfixture.example/v1/messages");
    expect(sent[0].body.model).toBe("fixture-model");
    expect(sent[0].body.messages).toBeDefined();
  } finally { globalThis.fetch = previous; }
}, 60000);

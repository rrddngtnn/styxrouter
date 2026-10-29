import { expect, test } from "bun:test";

process.env.API_KEY_SECRET = "synthetic-header-pin-review-secret";

test("HTTP combo honors an explicit connection header", async () => {
  const { createProviderConnection, createProviderNode } = await import("../src/lib/db/providers");
  const { createApiKey } = await import("../src/lib/db/apiKeys");
  const { createCombo } = await import("../src/lib/db/combos");
  const { initTranslators } = await import("../open-sse/translator/index");
  const { handleChat } = await import("../src/sse/handlers/chat");
  await initTranslators();
  const node: any = await createProviderNode({ type: "openai-compatible", name: "header-pin", prefix: "headerpin", apiType: "chat", baseUrl: "https://header-pin.invalid/v1" });
  await createProviderConnection({ provider: node.id, authType: "apikey", apiKey: "synthetic-header-a", isActive: true, priority: 1 } as any);
  const b = await createProviderConnection({ provider: node.id, authType: "apikey", apiKey: "synthetic-header-b", isActive: true, priority: 2 } as any);
  await createCombo({ name: "header-pin-combo", strategy: "priority", models: [{ kind: "model", model: `${node.id}/fixture`, providerId: node.id, weight: 100 }], config: { maxRetries: 0 } } as any);
  const key = await createApiKey("header-pin", "test");
  const original = globalThis.fetch; const seen: string[] = [];
  globalThis.fetch = (async (url: any, options: any) => {
    if (String(url).startsWith("http://127.0.0.1:")) return original(url, options);
    seen.push(new Headers(options?.headers).get("authorization") ?? "");
    return Response.json({ id: "fixture", object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }] });
  }) as typeof fetch;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handleChat });
  try {
    const res = await original(`http://127.0.0.1:${server.port}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key.key}`, "x-styx-connection": b.id }, body: JSON.stringify({ model: "header-pin-combo", messages: [{ role: "user", content: "hi" }], stream: false }) });
    await res.text();
    expect(res.status).toBe(200);
    expect(seen).toEqual(["Bearer synthetic-header-b"]);
  } finally { server.stop(true); globalThis.fetch = original; }
}, 60000);

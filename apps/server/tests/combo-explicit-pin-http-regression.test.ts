import { expect, test } from "bun:test";

process.env.API_KEY_SECRET = "synthetic-combo-pin-test-secret";

test("configured combo pin cannot dispatch an unavailable account's sibling", async () => {
  const { createProviderConnection, createProviderNode } = await import("../src/lib/db/providers");
  const { createApiKey } = await import("../src/lib/db/apiKeys");
  const { createCombo } = await import("../src/lib/db/combos");
  const { initTranslators } = await import("../open-sse/translator/index");
  const { handleChat } = await import("../src/sse/handlers/chat");
  await initTranslators();
  const node: any = await createProviderNode({ type: "openai-compatible", name: "pin-test", prefix: "pintest", apiType: "chat", baseUrl: "https://pin-test.invalid/v1" });
  await createProviderConnection({ provider: node.id, authType: "apikey", apiKey: "synthetic-sibling", isActive: true } as any);
  await createCombo({ name: "pin-combo-test", strategy: "priority", models: [{ kind: "model", model: `${node.id}/fixture`, providerId: node.id, connectionId: "missing-pin", weight: 100 }], config: { maxRetries: 0 } } as any);
  const key = await createApiKey("pin-test", "test");
  const original = globalThis.fetch; const sent: string[] = [];
  globalThis.fetch = (async (url: any, options: any) => {
    if (String(url).startsWith("http://127.0.0.1:")) return original(url, options);
    sent.push(new Headers(options?.headers).get("authorization") ?? "");
    return Response.json({ id: "fixture", object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }] });
  }) as typeof fetch;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handleChat });
  try {
    const res = await original(`http://127.0.0.1:${server.port}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key.key}` }, body: JSON.stringify({ model: "pin-combo-test", messages: [{ role: "user", content: "hi" }], stream: false }) });
    await res.text();
    expect(sent).toEqual([]);
    expect(res.status).not.toBe(200);
  } finally { server.stop(true); globalThis.fetch = original; }
}, 60000);


test("compatible provider explicit pin returns 429 without rotating siblings", async () => {
  const { createProviderConnection, createProviderNode } = await import("../src/lib/db/providers");
  const { createApiKey } = await import("../src/lib/db/apiKeys");
  const { initTranslators } = await import("../open-sse/translator/index");
  const { handleChat } = await import("../src/sse/handlers/chat");
  await initTranslators();
  const node: any = await createProviderNode({ type: "openai-compatible", name: "pin-429", prefix: "pin429", apiType: "chat", baseUrl: "https://pin-429.invalid/v1" });
  const a = await createProviderConnection({ provider: node.id, authType: "apikey", apiKey: "synthetic-ok", isActive: true, priority: 1 } as any);
  const b = await createProviderConnection({ provider: node.id, authType: "apikey", apiKey: "synthetic-429", isActive: true, priority: 2 } as any);
  const key = await createApiKey("pin-429-key", "test");
  const original = globalThis.fetch; const sent: string[] = [];
  globalThis.fetch = (async (url: any, options: any) => {
    if (String(url).startsWith("http://127.0.0.1:")) return original(url, options);
    const auth = new Headers(options?.headers).get("authorization") ?? ""; sent.push(auth);
    if (auth === "Bearer synthetic-429") return Response.json({error:{message:"rate limited"}}, {status:429, headers:{"retry-after":"1"}});
    return Response.json({ id:"fixture", object:"chat.completion", choices:[{index:0,message:{role:"assistant",content:"ok"},finish_reason:"stop"}] });
  }) as typeof fetch;
  const server = Bun.serve({ hostname:"127.0.0.1", port:0, fetch:handleChat });
  try {
    const res = await original(`http://127.0.0.1:${server.port}/v1/chat/completions`, {method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${key.key}`,"x-styx-connection":b.id},body:JSON.stringify({model:`${node.id}/fixture`,messages:[{role:"user",content:"hi"}],stream:false})});
    await res.text();
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every(auth => auth === "Bearer synthetic-429")).toBe(true);
    expect(res.status).toBe(429);
  } finally { server.stop(true); globalThis.fetch = original; }
}, 60000);


test("quota-restricted key cannot use an explicit pin outside its pool", async () => {
  const { createProviderConnection } = await import("../src/lib/db/providers");
  const { createApiKey, updateApiKeyPermissions } = await import("../src/lib/db/apiKeys");
  const { createPool } = await import("../src/lib/db/quotaPools");
  const { createGroup } = await import("../src/lib/db/quotaGroups");
  const { syncQuotaCombos } = await import("../src/lib/quota/quotaCombos");
  const { getCombos } = await import("../src/lib/db/combos");
  const { resolveQuotaKeyScope } = await import("../src/lib/quota/quotaKey");
  const { initTranslators } = await import("../open-sse/translator/index");
  const { handleChat } = await import("../src/sse/handlers/chat");
  await initTranslators();
  const a = await createProviderConnection({ provider:"openai", authType:"apikey", apiKey:"synthetic-quota-allowed", isActive:true } as any);
  const b = await createProviderConnection({ provider:"openai", authType:"apikey", apiKey:"synthetic-quota-denied", isActive:true } as any);
  const group = createGroup("Pin Quota");
  const pool = createPool({ connectionId:a.id, name:"pin-quota", groupId:group.id });
  await syncQuotaCombos(pool.id);
  const combo = (await getCombos()).find(c => String(c.name).startsWith("qtSd/pinquota/openai/"));
  expect(combo).toBeDefined();
  const scope = await resolveQuotaKeyScope([pool.id]);
  expect(scope.connectionIds).toContain(a.id);
  expect(scope.connectionIds).not.toContain(b.id);
  const key = await createApiKey("pin-quota-key", "test");
  await updateApiKeyPermissions(key.id, {allowedQuotas:[pool.id]});
  const original = globalThis.fetch; const sent:string[] = [];
  globalThis.fetch = (async (url:any, options:any) => {
    if (String(url).startsWith("http://127.0.0.1:")) return original(url, options);
    sent.push(String(url)); return Response.json({});
  }) as typeof fetch;
  const server = Bun.serve({hostname:"127.0.0.1",port:0,fetch:handleChat});
  try {
    const send = (connectionId: string) => original(`http://127.0.0.1:${server.port}/v1/chat/completions`, {method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${key.key}`,"x-styx-connection":connectionId},body:JSON.stringify({model:combo!.name,messages:[{role:"user",content:"hi"}],stream:false})});
    const res = await send(b.id);
    await res.text(); expect(res.status).not.toBe(200); expect(sent).toEqual([]);
    const allowed = await send(a.id);
    await allowed.text(); expect(sent.length).toBeGreaterThan(0);
  } finally {server.stop(true);globalThis.fetch=original;}
}, 60000);

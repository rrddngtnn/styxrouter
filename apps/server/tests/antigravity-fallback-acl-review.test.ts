import "./helpers/test-secrets";
import { expect, test } from "bun:test";

test("normal permitted Pro fallback dispatches the second model after a 400", async () => {
  const { createProviderConnection } = await import("../src/lib/db/providers.ts");
  const { createApiKey } = await import("../src/lib/db/apiKeys.ts");
  await createProviderConnection({ provider: "antigravity", authType: "oauth", accessToken: "synthetic", projectId: "fallback-project", isActive: true, name: "fixture" } as any);
  const key = await createApiKey("fallback-test", "test");
  const wire: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url, init) => {
    if (String(url).includes("auto-updater")) return Response.json([{ version: "1.0.0" }]);
    const payload = JSON.parse(await new Response(init?.body as BodyInit).text());
    wire.push(payload.model);
    if (payload.model === "gemini-3.1-pro-low") return Response.json({error: {message: "synthetic bad request"}}, {status: 400});
    return new Response('data: {"response":{"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}}\n\n', {status: 200, headers: {"content-type": "text/event-stream"}});
  }) as typeof fetch;
  try {
    const { handleChat } = await import("../src/sse/handlers/chat.ts");
    const response = await handleChat(new Request("http://localhost/v1/chat/completions", {method: "POST", headers: {"content-type": "application/json", authorization: `Bearer ${key.key}`}, body: JSON.stringify({model: "antigravity/gemini-3.1-pro-low", messages: [{role: "user", content: "hello"}], stream: true})}));
    await response.text();
    expect(wire).toEqual(["gemini-3.1-pro-low", "gemini-3-pro-low"]);
    expect(response.status).toBe(200);
  } finally { globalThis.fetch = original; }
}, 30000);

test.each(["acl", "inventory"])("fallback respects %s for actual dispatch", async (restriction) => {
  const { createProviderConnection, deleteProviderConnectionsByProvider } = await import("../src/lib/db/providers.ts");
  const { createApiKey, updateApiKeyPermissions } = await import("../src/lib/db/apiKeys.ts");
  const { replaceSyncedAvailableModelsForConnection } = await import("../src/lib/db/models.ts");
  await deleteProviderConnectionsByProvider("antigravity");
  const conn = await createProviderConnection({ provider: "antigravity", authType: "oauth", accessToken: "synthetic", projectId: "restricted-project", isActive: true } as any);
  if (restriction === "inventory") await replaceSyncedAvailableModelsForConnection("antigravity", conn.id, [{ id: "gemini-3.1-pro-low", name: "low" }]);
  const key = await createApiKey(`fallback-${restriction}`, "test");
  if (restriction === "acl") await updateApiKeyPermissions(key.id, { blockedModels: ["antigravity/gemini-3-pro-low"] });
  const wire: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url, init) => {
    if (String(url).includes("auto-updater")) return Response.json([{ version: "1.0.0" }]);
    if (!String(url).includes(":streamGenerateContent")) return Response.json({});
    wire.push(JSON.parse(await new Response(init?.body as BodyInit).text()).model);
    return Response.json({error: {message: "synthetic bad request"}}, {status: 400});
  }) as typeof fetch;
  try {
    const { handleChat } = await import("../src/sse/handlers/chat.ts");
    const response = await handleChat(new Request("http://localhost/v1/chat/completions", {method: "POST", headers: {"content-type": "application/json", authorization: `Bearer ${key.key}`}, body: JSON.stringify({model: "antigravity/gemini-3.1-pro-low", messages: [{role: "user", content: "hello"}], stream: true})}));
    await response.text();
    expect(response.ok).toBe(false);
    expect(wire).toEqual(["gemini-3.1-pro-low"]);
  } finally { globalThis.fetch = original; await deleteProviderConnectionsByProvider("antigravity"); }
}, 30000);

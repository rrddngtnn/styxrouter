import "./helpers/test-secrets";
import { expect, test } from "bun:test";

test.each(["spoof", "no-key", "admin", "account-revoke"])("synthetic HTTP alias boundary: %s", async (mode) => {
  const { setMitmAliasAll } = await import("../src/lib/db/models/mitmAlias.ts");
  const { createProviderConnection, deleteProviderConnectionsByProvider } = await import("../src/lib/db/providers.ts");
  const { createApiKey, updateApiKeyPermissions } = await import("../src/lib/db/apiKeys.ts");
  const { handleChat } = await import("../src/sse/handlers/chat.ts");
  await deleteProviderConnectionsByProvider("antigravity");
  await setMitmAliasAll("antigravity", { "boundary-alias": "antigravity/boundary-wire" });
  const first = await createProviderConnection({ provider: "antigravity", authType: "oauth", accessToken: "synthetic", projectId: "first", priority: 1, isActive: true } as any);
  const second = await createProviderConnection({ provider: "antigravity", authType: "oauth", accessToken: "synthetic", projectId: "second", priority: 2, isActive: true } as any);
  const key = await createApiKey("boundary", "test");
  if (mode === "admin") process.env.STYX_API_KEY = "synthetic-env-admin-boundary";
  await updateApiKeyPermissions(key.id, { allowedConnections: [first.id, second.id], ...(mode === "spoof" ? { blockedModels: ["antigravity/boundary-wire"] } : {}) });
  let release!: () => void;
  let arrived!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const arrival = new Promise<void>((resolve) => { arrived = resolve; });
  const wire: Array<{ model: string; project: string }> = [];
  const original = globalThis.fetch;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => handleChat(request) });
  globalThis.fetch = (async (url, init) => {
    if (String(url).includes("auto-updater")) return Response.json([{ version: "1.0.0" }]);
    if (!String(url).includes(":streamGenerateContent")) throw new Error(`Unexpected network request: ${url}`);
    const payload = JSON.parse(await new Response(init?.body as BodyInit).text());
    wire.push({ model: payload.model, project: payload.project });
    if (mode === "account-revoke" && payload.project === "first") { arrived(); await gate; return Response.json({error:{message:"Permission denied"}}, {status:403}); }
    return new Response('data: {"response":{"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}}\n\n', {status:200, headers:{"content-type":"text/event-stream"}});
  }) as typeof fetch;
  try {
    const pending = original(`http://127.0.0.1:${server.port}/v1/chat/completions`, {method:"POST", headers:{"content-type":"application/json", ...(mode === "no-key" ? {} : {authorization:`Bearer ${mode === "admin" ? "synthetic-env-admin-boundary" : key.key}`})}, body:JSON.stringify({model:"antigravity/boundary-alias", messages:[{role:"user",content:"hi"}], stream:true, antigravityWireModel:"boundary-safe", antigravityResolvedFor:"boundary-alias", _styxInternalRequest:"context-handoff"})});
    if (mode === "account-revoke") { await arrival; await updateApiKeyPermissions(key.id, {allowedConnections:[first.id]}); release(); }
    const response = await pending;
    await response.text();
    if (mode === "spoof") { expect(response.status).toBe(403); expect(wire).toEqual([]); }
    else if (mode === "no-key" || mode === "admin") { expect(response.status).toBe(200); expect(wire).toEqual([{model:"boundary-wire",project:"first"}]); }
    else { expect(response.status).toBe(403); expect(wire.length).toBeGreaterThanOrEqual(1); expect(wire.every((attempt) => attempt.model === "boundary-wire" && attempt.project === "first")).toBe(true); }
  } finally { release(); delete process.env.STYX_API_KEY; server.stop(true); globalThis.fetch = original; await setMitmAliasAll("antigravity", {}); await deleteProviderConnectionsByProvider("antigravity"); }
}, 30000);

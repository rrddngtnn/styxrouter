import "./helpers/test-secrets";
import { expect, test } from "bun:test";
import { createApiKey } from "../src/lib/db/apiKeys";
import { createProviderConnection, deleteProviderConnectionsByProvider, getProviderConnections } from "../src/lib/db/providers";
import { initTranslators } from "../open-sse/translator/index";
const { handleChat } = await import("../src/sse/handlers/chat");
const model = "gpt-5.5";
const notice = "This model requires a newer version of Codex. Please update to the latest version.";
for (const stream of [false, true]) for (const count of [1, 2]) test(`Codex client rejection preserves accounts stream=${stream} count=${count}`, async () => {
  await initTranslators();
  for (let i = 0; i < count; i++) await createProviderConnection({provider:"codex",authType:"oauth",accessToken:`synthetic-${i}`,refreshToken:`synthetic-refresh-${i}`,isActive:true,priority:i+1,providerSpecificData:{codexTransport:"http"}} as any);
  const key = await createApiKey(`codex-${stream}-${count}`, "test");
  const before = await getProviderConnections({provider:"codex"});
  const original = globalThis.fetch;
  let dispatches = 0, refreshes = 0;
  const seenModels: string[] = [];
  const server = Bun.serve({hostname:"127.0.0.1",port:0,fetch:handleChat});
  try {
    globalThis.fetch = (async (url, init) => {
      if (String(url).startsWith(`http://127.0.0.1:${server.port}/`)) return original(url,init);
      if (String(url).includes("/codex/responses")) {
        dispatches++;
        if (dispatches > 4) throw new Error("unexpected dispatch loop");
        seenModels.push(JSON.parse(await new Response(init?.body as BodyInit).text()).model);
        return Response.json({error:{message:notice}}, {status:400});
      }
      refreshes++;
      return Response.json({accessToken:"synthetic-renewed",expiresIn:3600});
    }) as typeof fetch;
    const r = await fetch(`http://127.0.0.1:${server.port}/v1/chat/completions`, {method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${key.key}`},body:JSON.stringify({model:`codex/${model}`,messages:[{role:"user",content:"hello"}],stream})});
    const text = await r.text();
    expect(r.status).toBe(502);
    expect(text).toContain("upstream_client_unsupported");
    expect(dispatches).toBe(1);
    expect(seenModels).toEqual([model]);
    expect(refreshes).toBe(0);
    const after = await getProviderConnections({provider:"codex"});
    for (const account of after) {
      const old = before.find(a => a.id === account.id)!;
      for (const field of ["isActive","testStatus","rateLimitedUntil","lastError","backoffLevel","accessToken","refreshToken"]) expect((account as any)[field]).toEqual((old as any)[field]);
    }
  } finally { globalThis.fetch = original; server.stop(true); await deleteProviderConnectionsByProvider("codex"); }
},60000);

test("genuine Codex 401 still reaches credential refresh through routing", async () => {
  await initTranslators();
  await createProviderConnection({ provider: "codex", authType: "oauth", accessToken: "synthetic-old", refreshToken: "synthetic-refresh", isActive: true, providerSpecificData: {codexTransport:"http"} } as any);
  const key = await createApiKey("codex-auth-recovery", "test");
  const original = globalThis.fetch;
  let refreshes = 0, dispatches = 0;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handleChat });
  try {
    globalThis.fetch = (async (url, init) => {
      if (String(url).startsWith(`http://127.0.0.1:${server.port}/`)) return original(url, init);
      if (String(url).includes("/codex/responses")) {
        dispatches++;
        return Response.json({ message: "Invalid token" }, { status: 401 });
      }
      refreshes++;
      return Response.json({ message: "synthetic refresh denied" }, { status: 400 });
    }) as typeof fetch;
    const response = await fetch(`http://127.0.0.1:${server.port}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key.key}` }, body: JSON.stringify({ model: `codex/${model}`, messages: [{ role: "user", content: "hello" }], stream: false }) });
    const text = await response.text();
    expect(response.ok).toBe(false);
    expect(text).not.toContain("upstream_client_unsupported");
    expect(dispatches).toBe(1);
    expect(refreshes).toBeGreaterThan(0);
  } finally { globalThis.fetch = original; server.stop(true); await deleteProviderConnectionsByProvider("codex"); }
}, 60000);

test("ordinary Codex 400/401 responses retain their original semantics", async () => {
  const { CodexExecutor } = await import("../open-sse/executors/codex");
  const original = globalThis.fetch;
  try {
    for (const [status, message] of [
      [400, "Invalid input: missing required parameter"],
      [400, `Quoted: ${notice}`],
      [400, "This model is not supported"],
      [401, "Invalid token"],
      [401, notice],
      [500, notice],
    ] as const) {
      const response = Response.json({error:{message}}, {status});
      globalThis.fetch = (async () => response) as typeof fetch;
      const result = await new CodexExecutor().execute({
        model, body:{input:"fixture"}, stream:false,
        credentials:{accessToken:"synthetic", providerSpecificData:{codexTransport:"http"}},
      } as any);
      expect(result.response.status).toBe(status);
      expect(await result.response.json()).toEqual({error:{message}});
    }
  } finally { globalThis.fetch = original; }
});

import "./helpers/test-secrets";
import { expect, test } from "bun:test";
import { createApiKey } from "../src/lib/db/apiKeys";
import { createProviderConnection, deleteProviderConnectionsByProvider, getProviderConnections } from "../src/lib/db/providers";
import { initTranslators } from "../open-sse/translator/index";
const { handleChat } = await import("../src/sse/handlers/chat");
const model = "claude-sonnet-5.5";
const notice = "This version of Kiro is no longer supported. Please update to the latest version of Kiro to continue.";
for (const stream of [false, true]) for (const count of [1, 2]) test(`Kiro client rejection preserves accounts stream=${stream} count=${count}`, async () => {
  await initTranslators();
  for (let i = 0; i < count; i++) await createProviderConnection({provider:"kiro",authType:"oauth",accessToken:`synthetic-${i}`,refreshToken:`synthetic-refresh-${i}`,isActive:true,priority:i+1,providerSpecificData:{}} as any);
  const key = await createApiKey(`kiro-${stream}-${count}`, "test");
  const before = await getProviderConnections({provider:"kiro"});
  const original = globalThis.fetch;
  let dispatches = 0, refreshes = 0;
  const server = Bun.serve({hostname:"127.0.0.1",port:0,fetch:handleChat});
  try {
    globalThis.fetch = (async (url, init) => {
      if (String(url).startsWith(`http://127.0.0.1:${server.port}/`)) return original(url,init);
      if (String(url).includes("generateAssistantResponse")) {
        dispatches++;
        if (dispatches > 4) throw new Error("unexpected dispatch loop");
        return Response.json({message:notice}, {status:403});
      }
      refreshes++;
      return Response.json({accessToken:"synthetic-renewed",expiresIn:3600});
    }) as typeof fetch;
    const r = await fetch(`http://127.0.0.1:${server.port}/v1/chat/completions`, {method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${key.key}`},body:JSON.stringify({model:`kiro/${model}`,messages:[{role:"user",content:"hello"}],stream})});
    const text = await r.text();
    expect(r.status).toBe(502);
    expect(text).toContain("upstream_client_unsupported");
    expect(dispatches).toBe(1);
    expect(refreshes).toBe(0);
    const after = await getProviderConnections({provider:"kiro"});
    for (const account of after) {
      const old = before.find(a => a.id === account.id)!;
      for (const field of ["isActive","testStatus","rateLimitedUntil","lastError","backoffLevel","accessToken","refreshToken"]) expect((account as any)[field]).toEqual((old as any)[field]);
    }
  } finally { globalThis.fetch = original; server.stop(true); await deleteProviderConnectionsByProvider("kiro"); }
},60000);

test("genuine Kiro 401 still reaches credential refresh through routing", async () => {
  await initTranslators();
  await createProviderConnection({ provider: "kiro", authType: "oauth", accessToken: "synthetic-old", refreshToken: "synthetic-refresh", isActive: true, providerSpecificData: {} } as any);
  const key = await createApiKey("kiro-auth-recovery", "test");
  const original = globalThis.fetch;
  let refreshes = 0, dispatches = 0;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handleChat });
  try {
    globalThis.fetch = (async (url, init) => {
      if (String(url).startsWith(`http://127.0.0.1:${server.port}/`)) return original(url, init);
      if (String(url).includes("generateAssistantResponse")) {
        dispatches++;
        return Response.json({ message: "Invalid token" }, { status: 401 });
      }
      refreshes++;
      return Response.json({ message: "synthetic refresh denied" }, { status: 400 });
    }) as typeof fetch;
    const response = await fetch(`http://127.0.0.1:${server.port}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key.key}` }, body: JSON.stringify({ model: `kiro/${model}`, messages: [{ role: "user", content: "hello" }], stream: false }) });
    const text = await response.text();
    expect(response.ok).toBe(false);
    expect(text).not.toContain("upstream_client_unsupported");
    expect(dispatches).toBe(1);
    expect(refreshes).toBeGreaterThan(0);
  } finally { globalThis.fetch = original; server.stop(true); await deleteProviderConnectionsByProvider("kiro"); }
}, 60000);

test("ordinary upstream errors pass through the Kiro executor unchanged", async () => {
  const { KiroExecutor } = await import("../open-sse/executors/kiro");
  const { classifyProviderError } = await import("../open-sse/services/errorClassifier");
  const original = globalThis.fetch;
  try {
    for (const [status, message] of [[401,"Invalid token"],[403,"Forbidden"],[403,"Account banned"],[403,"Model access denied"],[403,`Quoted: ${notice}`],[500,notice]] as const) {
      const response = Response.json({message},{status});
      globalThis.fetch = (async () => response) as typeof fetch;
      const result = await new KiroExecutor().execute({model,body:{},stream:false,credentials:{accessToken:"synthetic"}} as any);
      expect(result.response).toBe(response);
      expect(await result.response.json()).toEqual({message});
    }
    expect(classifyProviderError(401,{message:"Unauthorized"},"kiro")).toBe("unauthorized");
    expect(classifyProviderError(403,{message:"Forbidden"},"kiro")).toBe("forbidden");
  } finally { globalThis.fetch = original; }
});

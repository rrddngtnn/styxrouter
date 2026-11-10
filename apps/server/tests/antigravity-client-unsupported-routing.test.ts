import "./helpers/test-secrets";
import { expect, test, mock } from "bun:test";
import { createApiKey } from "../src/lib/db/apiKeys";
import { createProviderConnection, deleteProviderConnectionsByProvider, getProviderConnections } from "../src/lib/db/providers";
import { initTranslators } from "../open-sse/translator/index";
const { handleChat } = await import("../src/sse/handlers/chat");
const model = "gemini-4-argon-medium";
const retirement = "This version of Antigravity is no longer supported. Please download and install the latest version at https://antigravity.google/download to continue using the agent and unlock our latest models, including Gemini 4 Argon on eligible plans.";
const event = (text:string) => `data: ${JSON.stringify({response:{candidates:[{content:{role:"model",parts:[{text}]},finishReason:"STOP"}]}})}\n\n`;
for (const stream of [false, true]) for (const secondAccount of [true, false]) test(`client unsupported must not poison account state stream=${stream} second=${secondAccount}`, async () => {

 await initTranslators();
 process.env.STYX_ANTIGRAVITY_CLIENT_PROFILE = "hub";
 const suffix = String(stream);
 for (const [priority, profile] of (secondAccount ? [[1,"hub"],[2,"ide"]] : [[1,"hub"]]) as Array<[number,string]>) await createProviderConnection({provider:"antigravity",authType:"oauth",accessToken:`synthetic-${suffix}-${profile}`,projectId:`project-${profile}`,isActive:true,priority,providerSpecificData:{}} as any);
 const key = await createApiKey(`agy-${suffix}`, "test");
 const seen: Array<{token:string, model:string, ua:string}> = [];
 const original = globalThis.fetch;
 const server = Bun.serve({hostname:"127.0.0.1",port:0,fetch:handleChat});
 try {
  globalThis.fetch = (async (url, init) => {
   if (String(url).startsWith(`http://127.0.0.1:${server.port}/`)) return original(url,init);
   if (String(url).includes("auto-updater")) return Response.json([{version:"1.0.0"}]);
   if (!String(url).includes(":streamGenerateContent")) return Response.json({models:{},buckets:[]});
   const headers = new Headers(init?.headers);
   const token = headers.get("authorization") || "";
   const sentModel = JSON.parse(await new Response(init?.body as BodyInit).text()).model;
   seen.push({token,model:sentModel,ua:headers.get("user-agent") || ""});
   if (seen.length > 2) throw new Error("unexpected retry loop");
   return new Response(event(token.endsWith("-hub") && sentModel === model ? retirement : sentModel === model ? "ok" : "wrong sibling"),{headers:{"content-type":"text/event-stream"}});
  }) as typeof fetch;
  const r = await fetch(`http://127.0.0.1:${server.port}/v1/chat/completions`,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${key.key}`},body:JSON.stringify({model:`antigravity/${model}`,messages:[{role:"user",content:"hello"}],stream})});
  const text = await r.text();

  expect(r.status).toBe(502);
  expect(text).toContain("upstream_client_unsupported");
  expect(seen.map(x=>x.model)).toEqual([model]);
  const accounts = await getProviderConnections({provider:"antigravity"});
  for (const account of accounts) {
   expect(account.isActive).toBe(true);
   expect(account.rateLimitedUntil ?? null).toBe(null);
   expect(account.lastError ?? null).toBe(null);
   expect(account.backoffLevel ?? 0).toBe(0);
  }

 } finally { globalThis.fetch = original; server.stop(true); await deleteProviderConnectionsByProvider("antigravity"); }
},60000);

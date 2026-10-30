import "./helpers/test-secrets";
import { expect, test } from "bun:test";
import { parseUpstreamError } from "../open-sse/utils/error";
import { createApiKey } from "../src/lib/db/apiKeys";
import { createProviderConnection, getProviderConnections } from "../src/lib/db/providers";
import { initTranslators } from "../open-sse/translator/index";
import { handleChat } from "../src/sse/handlers/chat";

const event = 'data: {"id":"chatcmpl-test","object":"chat.completion.chunk","created":1,"model":"deepseek-v3.2","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":null}]}\n\ndata: {"id":"chatcmpl-test","object":"chat.completion.chunk","created":1,"model":"deepseek-v3.2","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';

test("CodeBuddy 6000 rotates synthetic accounts and observes Retry-After", async () => {
 await initTranslators();
 const a = await createProviderConnection({ provider: "codebuddy-cn", authType: "oauth", accessToken: "synthetic-a", isActive: true, priority: 1 } as any);
 const b = await createProviderConnection({ provider: "codebuddy-cn", authType: "oauth", accessToken: "synthetic-b", isActive: true, priority: 2 } as any);
 const key = await createApiKey("cbcn-routing", "test");
 const seen: string[] = []; const previous = globalThis.fetch;
 try {
  globalThis.fetch = (async (url, options) => {
   if (!String(url).startsWith("https://copilot.tencent.com/v2/chat/completions")) throw new Error("Unexpected outbound blocked");
   const auth = new Headers(options?.headers).get("authorization") ?? ""; seen.push(auth);
   return auth === "Bearer synthetic-a" ? new Response(JSON.stringify({code:6000,msg:"quota exhausted"}), {status:429,headers:{"content-type":"application/json","retry-after":"120"}}) : new Response(event,{headers:{"content-type":"text/event-stream"}});
  }) as typeof fetch;
  const r = await handleChat(new Request("http://localhost/v1/chat/completions", {method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${key.key}`},body:JSON.stringify({model:"codebuddy-cn/deepseek-v3.2",messages:[{role:"user",content:"hi"}],stream:true})}));
  await r.text(); expect(r.status).toBe(200); expect(seen).toEqual(["Bearer synthetic-a", "Bearer synthetic-b"]);
  const rows: any[] = await getProviderConnections({provider:"codebuddy-cn"}) as any;
  const failed = rows.find(x=>x.id===a.id); const healthy = rows.find(x=>x.id===b.id);
  expect(new Date(failed.rateLimitedUntil).getTime() - Date.now()).toBeGreaterThan(110000);
  expect(healthy.rateLimitedUntil ?? null).toBeNull();
 } finally { globalThis.fetch = previous; }
}, 60000);

test("Retry-After HTTP date beginning with a digit is interpreted as a date", async () => {
 const date = new Date(Date.now() + 120000).toUTCString().replace(/^\w+, /, "");
 const result = await parseUpstreamError(new Response('{"code":6000,"msg":"quota exhausted"}', { status:429, headers:{"retry-after":date} }), "codebuddy-cn");
 expect(result.retryAfterMs).toBeGreaterThan(110000);
});

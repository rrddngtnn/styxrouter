import "./helpers/test-secrets";
import { expect, test } from "bun:test";
import { CodeBuddyCnExecutor } from "../open-sse/executors/codebuddy-cn";
import { createApiKey } from "../src/lib/db/apiKeys";
import { createProviderConnection, getProviderConnections } from "../src/lib/db/providers";
import { initTranslators } from "../open-sse/translator/index";
import { handleChat } from "../src/sse/handlers/chat";

const secret = "synthetic-upstream-secret";
const envelope = JSON.stringify({ code: 6004, msg: `超出频率限制 ${secret}` });

test("executor normalizes HTTP 200 frequency envelopes without disclosing upstream text", async () => {
 const old = globalThis.fetch;
 try {
  for (const stream of [true, false]) {
   globalThis.fetch = (async () => new Response(envelope, {headers: {"content-type":"application/json", "retry-after":"120"}})) as typeof fetch;
   const result: any = await new CodeBuddyCnExecutor().execute({model:"fixture",body:{messages:[{role:"user",content:"hi"}]},stream,credentials:{accessToken:secret}} as any);
   const response = result instanceof Response ? result : result.response;
   expect(response.status).toBe(429);
   expect(response.headers.get("retry-after")).toBe("120");
   expect(await response.text()).not.toContain(secret);
  }
 } finally { globalThis.fetch = old; }
});

test("only matching JSON envelopes normalize; 6000, normal JSON, malformed JSON and SSE pass through", async () => {
 const old = globalThis.fetch;
 try {
  for (const [body, contentType, status] of [
   ['{"code":6004}', 'application/json', 429],
   ['{"message":"frequency limit reached"}', 'application/json', 429],
   ['{"error":{"message":"超出频率限制"}}', 'application/json', 429],
   ['{"code":6000,"msg":"frequency limit"}', 'application/json', 200],
   ['{"code":6001,"msg":"other"}', 'application/json', 200],
   ['not json', 'application/json', 200],
   ['data: {"code":6004}\n\n', 'text/event-stream', 200],
  ] as const) {
   globalThis.fetch = (async () => new Response(body, {headers:{"content-type":contentType}})) as typeof fetch;
   const result:any = await new CodeBuddyCnExecutor().execute({model:"fixture",body:{messages:[]},stream:true,credentials:{accessToken:secret}} as any);
   const response = result instanceof Response ? result : result.response;
   expect(response.status).toBe(status);
   if (status === 200) expect(await response.text()).toBe(body);
  }
 } finally { globalThis.fetch = old; }
});

test("chat route rotates on HTTP 200 semantic rate limit for streaming and nonstream clients", async () => {
 await initTranslators();
 const a = await createProviderConnection({provider:"codebuddy-cn",authType:"oauth",accessToken:secret,isActive:true,priority:1} as any);
 await createProviderConnection({provider:"codebuddy-cn",authType:"oauth",accessToken:"synthetic-backup",isActive:true,priority:2} as any);
 const key = await createApiKey("semantic-rate-limit", "test");
 const old = globalThis.fetch;
 const seen: string[] = [];
 const event = 'data: {"id":"test","object":"chat.completion.chunk","created":1,"model":"deepseek-v3.2","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":null}]}\n\ndata: {"id":"test","object":"chat.completion.chunk","created":1,"model":"deepseek-v3.2","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
 try {
  globalThis.fetch = (async (url, init) => {
   if (!String(url).startsWith("https://copilot.tencent.com/v2/chat/completions")) throw new Error("unexpected outbound");
   const auth = new Headers(init?.headers).get("authorization") ?? ""; seen.push(auth);
   return auth === `Bearer ${secret}` ? new Response(envelope, {headers:{"content-type":"application/json","retry-after":"120"}}) : new Response(event,{headers:{"content-type":"text/event-stream"}});
  }) as typeof fetch;
  for (const stream of [true, false]) {
   const response = await handleChat(new Request("http://localhost/v1/chat/completions",{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${key.key}`},body:JSON.stringify({model:"codebuddy-cn/deepseek-v3.2",messages:[{role:"user",content:"hi"}],stream})}));
   const body = await response.text();
   expect(response.status).toBe(200); expect(body).toContain("ok"); expect(body).not.toContain(secret);
  }
  expect(seen).toContain(`Bearer ${secret}`); expect(seen).toContain("Bearer synthetic-backup");
  const rows:any[] = await getProviderConnections({provider:"codebuddy-cn"}) as any;
  expect(Date.parse(rows.find(x=>x.id===a.id).rateLimitedUntil) - Date.now()).toBeGreaterThan(110000);
 } finally { globalThis.fetch = old; }
}, 60000);

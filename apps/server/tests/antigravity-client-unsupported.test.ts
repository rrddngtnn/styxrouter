import { test, expect } from "bun:test";
import { preflightUnsupportedClient } from "../open-sse/executors/antigravity/unsupportedClientPreflight";
const notice = "This version of Antigravity is no longer supported. Please download and install the latest version at https://antigravity.google/download to continue using the agent and unlock our latest models, including Gemini 4 Argon on eligible plans.";
function response(text: string) {return new Response('data: '+JSON.stringify({response:{candidates:[{content:{parts:[{text}]}}]}})+'\n\n', {headers:{'content-type':'text/event-stream'}});}
test("client retirement is upstream version failure, never account-model retirement",async()=>{
 const r = await preflightUnsupportedClient(response(notice));
 expect(r.status).toBe(502);
 expect((await r.json()).error.code).toBe('upstream_client_unsupported');
});
test("quoted notice is not intercepted",async()=>{
 const r = await preflightUnsupportedClient(response('Documentation says: '+notice));
 expect(r.status).toBe(200); expect(await r.text()).toContain('Documentation says:');
});
test("account verification errors are not version failure",async()=>{
 const r=Response.json({error:{code:403,details:[{reason:'VALIDATION_REQUIRED'}]}},{status:403});
 expect(await preflightUnsupportedClient(r)).toBe(r);
});


test("unsupported client is not a model-unavailable fallback signal", async () => {
 const { isModelUnavailableError } = await import("../open-sse/services/modelFamilyFallback");
 const r = await preflightUnsupportedClient(response(notice));
 const body = await r.json();
 expect(r.status).toBe(502);
 expect(isModelUnavailableError(r.status, body.error.message, "antigravity")).toBe(false);

});


test("split CRLF unsupported notice is classified only at EOF", async () => {
 const frame = (text: string) => 'data: '+JSON.stringify({response:{candidates:[{content:{parts:[{text}]}}]}})+'\r\n\r\n';
 const bytes = new TextEncoder().encode(frame(notice.slice(0,40))+frame(notice.slice(40)));
 const stream = new ReadableStream<Uint8Array>({start(c) { for (const b of bytes) c.enqueue(Uint8Array.of(b)); c.close(); }});
 expect((await preflightUnsupportedClient(new Response(stream,{headers:{"content-type":"text/event-stream"}}))).status).toBe(502);
});
test("extended, structured, and late unsupported output is replayed", async () => {
 for (const content of [{parts:[{text:notice+" Extra"}]},{parts:[{text:notice},{functionCall:{name:"sample",args:{}}}]}]) {
  const input = 'data: '+JSON.stringify({response:{candidates:[{content}]}})+'\n\n';
  const r = await preflightUnsupportedClient(new Response(input,{headers:{"content-type":"text/event-stream"}}));
  expect(r.status).toBe(200); expect(await r.text()).toBe(input);
 }
 const input = await response(notice).text();
 const stream = new ReadableStream<Uint8Array>({start(c) { setTimeout(()=>{c.enqueue(new TextEncoder().encode(input));c.close();},350); }});
 const r = await preflightUnsupportedClient(new Response(stream,{headers:{"content-type":"text/event-stream"}}));
 expect(r.status).toBe(200); expect(await r.text()).toBe(input);
});


test("replayed bytes preserve malformed frames and UTF-8", async () => {
  const bytes = new TextEncoder().encode('data: {invalid}\r\n\r\n😀');
  const result = await preflightUnsupportedClient(new Response(bytes, { headers: { "content-type": "text/event-stream" } }));
  expect(new Uint8Array(await result.arrayBuffer())).toEqual(bytes);
});

test("replay cancellation reaches a pending upstream read", async () => {
  let cancelled: unknown;
  const input = new ReadableStream<Uint8Array>({ cancel(reason) { cancelled = reason; } });
  const result = await preflightUnsupportedClient(new Response(input, { headers: { "content-type": "text/event-stream" } }));
  await result.body!.cancel("client disconnected");
  expect(cancelled).toBe("client disconnected");
});

test("upstream abort during preflight propagates", async () => {
  const input = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new DOMException("aborted", "AbortError")); } });
  await expect(preflightUnsupportedClient(new Response(input, { headers: { "content-type": "text/event-stream" } }))).rejects.toThrow("aborted");
});

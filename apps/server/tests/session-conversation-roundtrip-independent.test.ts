import { expect, test } from "bun:test";
import { createApiKey } from "../src/lib/db/apiKeys";
import { createProviderNode, createProviderConnection } from "../src/lib/db/providers";
import { initTranslators } from "../open-sse/translator/index";
import { handleChat } from "../src/sse/handlers/chat";

test("explicit conversation response header remains usable as the next request session header", async () => {
  await initTranslators();
  const node: any = await createProviderNode({type:"openai-compatible", name:"roundtripreview", prefix:"roundtripreview", apiType:"chat", baseUrl:"https://roundtripreview.example/v1"});
  await createProviderConnection({provider:node.id,authType:"apikey",apiKey:"synthetic"} as any);
  const key = await createApiKey("roundtripreview", "test");
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any, opts: any) => String(url).startsWith("http://127.0.0.1:") ? realFetch(url, opts) : Response.json({id:"fixture",object:"chat.completion",model:"fixture",choices:[{index:0,message:{role:"assistant",content:"ok"},finish_reason:"stop"}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}})) as typeof fetch;
  const server = Bun.serve({hostname:"127.0.0.1",port:0,fetch:handleChat});
  const send = (session: string) => realFetch(`http://127.0.0.1:${server.port}/v1/chat/completions`,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${key.key}`,"x-styx-session-id":session},body:JSON.stringify({model:"roundtripreview/fixture",messages:[{role:"user",content:"hi"}]})});
  try {
    const first = await send("client-conversation"); expect(first.status).toBe(200); await first.text();
    const id = first.headers.get("x-conversationid"); expect(id).toBeTruthy();
    const second = await send(id!); expect(second.status).toBe(200); await second.text();
    expect(second.headers.get("x-conversationid")).toBe(id);
  } finally {server.stop(true);globalThis.fetch = realFetch;}
},60000);

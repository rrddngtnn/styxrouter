import { expect, test } from "bun:test";
import { createApiKey } from "../src/lib/db/apiKeys";
import { createProviderNode, createProviderConnection } from "../src/lib/db/providers";
import { getDbInstance } from "../src/lib/db/core";
import { initTranslators } from "../open-sse/translator/index";
import { handleChat } from "../src/sse/handlers/chat";

test("same client session id under distinct API keys creates independent affinity pins", async () => {
  await initTranslators();
  const node: any = await createProviderNode({type:"openai-compatible",name:"isolationfixture",prefix:"isolationfixture",apiType:"chat",baseUrl:"https://isolationfixture.example/v1"});
  await createProviderConnection({provider:node.id,authType:"apikey",apiKey:"synthetic-upstream"} as any);
  const a = await createApiKey("isolation-a", "test");
  const b = await createApiKey("isolation-b", "test");
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any, opts: any) => !String(url).startsWith("http://127.0.0.1:") ? Response.json({id:"fixture",object:"chat.completion",model:"fixture",choices:[{index:0,message:{role:"assistant",content:"ok"},finish_reason:"stop"}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}) : realFetch(url, opts)) as typeof fetch;
  const server = Bun.serve({hostname:"127.0.0.1",port:0,fetch:handleChat});
  try {
    for (const key of [a.key, b.key]) {
      const res = await realFetch(`http://127.0.0.1:${server.port}/v1/chat/completions`, {method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${key}`,"x-session-id":"same-client-session"},body:JSON.stringify({model:"isolationfixture/fixture",stream:false,messages:[{role:"user",content:"hi"}]})});
      expect(res.status).toBe(200);
      await res.text();
    }
    const row = getDbInstance().prepare("SELECT COUNT(*) AS n FROM key_value WHERE namespace = ? AND key LIKE ?").get("session_account_affinity", `${node.id}:%`) as {n:number};
    expect(row.n).toBe(2);
  } finally { server.stop(true); globalThis.fetch = realFetch; }
}, 60000);

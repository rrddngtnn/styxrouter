import { expect, test } from "bun:test";

test("tagged pipeline requests never use an unmatched account", async () => {
  // Synthetic fixture; initialize auth only after the isolated test secret is set.
  process.env.API_KEY_SECRET = "synthetic-combo-prelude-test-secret";
  const { createApiKey } = await import("../src/lib/db/apiKeys");
  const { createProviderNode, createProviderConnection } = await import("../src/lib/db/providers");
  const { createCombo } = await import("../src/lib/db/combos");
  const { initTranslators } = await import("../open-sse/translator/index");
  const { handleChat } = await import("../src/sse/handlers/chat");
  await initTranslators();
  const node: any = await createProviderNode({type:"openai-compatible",name:"prelude-fixture",prefix:"preludefixt",apiType:"chat",baseUrl:"https://prelude.invalid/v1"});
  await createProviderConnection({provider:node.id,authType:"apikey",name:"red",apiKey:"fixture-red",isActive:true,providerSpecificData:{tags:["red"],baseUrl:"https://prelude.invalid/v1",apiType:"chat"}} as any);
  for (const strategy of ["pipeline", "fusion"]) await createCombo({name:`prelude-${strategy}`,strategy,models:[`${node.id}/fixture-model`]} as any);
  const key = await createApiKey("prelude-key", "test");
  const original = globalThis.fetch;
  const sent: string[] = [];
  globalThis.fetch = (async (url: any, options: any) => {
    if (String(url).startsWith("http://127.0.0.1:")) return original(url, options);
    sent.push(String(url));
    return Response.json({id:"fixture",object:"chat.completion",model:"fixture-model",choices:[{index:0,message:{role:"assistant",content:"ok"},finish_reason:"stop"}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}});
  }) as typeof fetch;
  const server = Bun.serve({hostname:"127.0.0.1",port:0,fetch:handleChat});
  try {
    for (const strategy of ["pipeline"]) {
      sent.length = 0;
      const response = await original(`http://127.0.0.1:${server.port}/v1/chat/completions`, {method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${key.key}`},body:JSON.stringify({model:`prelude-${strategy}`,messages:[{role:"user",content:"hi"}],stream:false,metadata:{tags:["blue"]}})});
      await response.text();
      expect({strategy,sent}).toEqual({strategy,sent:[]});
      expect(response.status).not.toBe(200);
    }
  } finally { server.stop(true); globalThis.fetch = original; }
}, 60000);

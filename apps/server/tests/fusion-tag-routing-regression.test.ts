import "./helpers/test-secrets";
import { expect, test } from "bun:test";
import { createApiKey } from "../src/lib/db/apiKeys";
import { createProviderNode, createProviderConnection } from "../src/lib/db/providers";
import { createCombo } from "../src/lib/db/combos";
import { initTranslators } from "../open-sse/translator/index";
import { handleChat } from "../src/sse/handlers/chat";

test("tagged fusion requests never use an unmatched account", async () => {
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
    for (const strategy of ["fusion"]) {
      sent.length = 0;
      const response = await original(`http://127.0.0.1:${server.port}/v1/chat/completions`, {method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${key.key}`},body:JSON.stringify({model:`prelude-${strategy}`,messages:[{role:"user",content:"hi"}],stream:false,metadata:{tags:["blue"]}})});
      await response.text();
      expect({strategy,sent}).toEqual({strategy,sent:[]});
      expect(response.status).not.toBe(200);
      sent.length = 0;
      const untagged = await original(`http://127.0.0.1:${server.port}/v1/chat/completions`, {method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${key.key}`},body:JSON.stringify({model:`prelude-${strategy}`,messages:[{role:"user",content:"hi"}],stream:false})});
      expect(untagged.status).toBe(200);
      expect(sent.length).toBeGreaterThan(0);
    }
  } finally { server.stop(true); globalThis.fetch = original; }
}, 60000);


test("fusion retains selected target for tool bypass and survivor judge", async () => {
  const { handleFusionChat } = await import("../open-sse/services/fusion");
  const target = (name: string) => ({ kind: "model", modelStr: name, provider: "p", providerId: "p", executionKey: name, allowedConnectionIds: ["blue"] }) as any;
  const a = target("p/a"), b = target("p/b");
  const seen: any[] = [];
  const dispatch = async (_body: any, model: string, selected: any) => { seen.push({model, selected}); return Response.json({choices:[{message:{content:"answer"}}]}); };
  const log = { info() {}, warn() {}, error() {} };
  await handleFusionChat({body:{tools:[{type:"function",function:{name:"f"}}]},models:[a,b],handleSingleModel:dispatch,log});
  expect(seen[0].selected).toBe(a);
  seen.length = 0;
  await handleFusionChat({body:{},models:[a,b],handleSingleModel:dispatch,log});
  expect(seen.length).toBe(3);
  expect(seen[2].selected).toBe(a);
  seen.length = 0;
  await handleFusionChat({body:{},models:[a,b],log,handleSingleModel:async (body, model, selected) => {
    if (model === a.modelStr) return new Response("failed", {status:503});
    return dispatch(body, model, selected);
  }});
  expect(seen.length).toBe(2);
  expect(seen[1].selected).toBe(b);
  seen.length = 0;
  await handleFusionChat({body:{},models:[a,b],judgeModel:b.modelStr,judgeTarget:b,handleSingleModel:dispatch,log});
  expect(seen[2].selected).toBe(b);
});


test("tagged fusion refuses bare and mismatched judge targets before dispatch", async () => {
 const { handleFusionChat } = await import("../open-sse/services/fusion");
 const a:any = { modelStr:"p/a", provider:"p", executionKey:"a", allowedConnectionIds:["blue"] };
 const log = {info(){},warn(){},error(){}}; let calls=0;
 const handleSingleModel = async () => { calls++; return Response.json({}); };
 for (const options of [{ models:["p/a"] }, {models:[a,a],judgeModel:"p/b",judgeTarget:a}]) {
   const res = await handleFusionChat({body:{metadata:{tags:["blue"]}},log,handleSingleModel,...options} as any);
   expect(res.status).not.toBe(200); expect(calls).toBe(0);
 }
});

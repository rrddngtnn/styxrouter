import { expect, test } from "bun:test";

test("combined prelude modes over HTTP: unmatched, matching and untagged", async () => {
  // Synthetic fixture; initialize auth only after the isolated test secret is set.
  process.env.API_KEY_SECRET = "synthetic-combo-prelude-test-secret";
  const { createProviderConnection, createProviderNode } = await import("../src/lib/db/providers");
  const { createApiKey } = await import("../src/lib/db/apiKeys");
  const { createCombo } = await import("../src/lib/db/combos");
  const { initTranslators } = await import("../open-sse/translator/index");
  const { handleChat } = await import("../src/sse/handlers/chat");
  const { recordSessionModelUsage } = await import("../src/lib/db/contextHandoffs");
  const { deriveComboSessionKey } = await import("../open-sse/services/combo/autoStrategy");
  await initTranslators();
  const node: any = await createProviderNode({type:"openai-compatible",name:"combined-http",prefix:"combinedhttp",apiType:"chat",baseUrl:"https://combined.invalid/v1"});
  await createProviderConnection({provider:node.id,authType:"apikey",name:"red",apiKey:"fixture-key",providerSpecificData:{tags:["red"]}} as any);
  const model = `${node.id}/fixture-model`;
  const child: any = await createCombo({name:"combined-child",strategy:"priority",models:[model]} as any);
  for (const mode of ["fusion","chaos","pin","nested"]) {
    await createCombo({name:`combined-${mode}`,strategy:mode === "fusion" ? "fusion" : "priority",models:mode === "nested" ? [model,{kind:"combo-ref",comboName:child.name}] : [model],config:{maxRetries:0,...(mode === "chaos" ? {chaos:{enabled:true}} : {}),...(mode === "nested" ? {nestedComboMode:"execute"} : {})},context_cache_protection:mode === "pin"} as any);
  }
  const key = await createApiKey("combined-http-key", "test");
  const original = globalThis.fetch;
  const sent: string[] = [];
  globalThis.fetch = (async (url: any, options: any) => {
    if (String(url).startsWith("http://127.0.0.1:")) return original(url, options);
    sent.push(String(url));
    return Response.json({id:"fixture",object:"chat.completion",model:"fixture-model",choices:[{index:0,message:{role:"assistant",content:"ok"},finish_reason:"stop"}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}});
  }) as typeof fetch;
  const server = Bun.serve({hostname:"127.0.0.1",port:0,fetch:handleChat});
  try {
    for (const mode of ["fusion","chaos","pin","nested"]) {
      for (const tag of ["blue","red",null]) {
        const body: any = {model:`combined-${mode}`,messages:[{role:"user",content:`hi ${mode}`}],stream:false,...(tag ? {metadata:{tags:[tag]}} : {})};
        if (mode === "pin") {
          const session = deriveComboSessionKey(body);
          if (!session) throw new Error("missing session");
          recordSessionModelUsage(session,body.model,model,node.id);
        }
        sent.length = 0;
        const result = await original(`http://127.0.0.1:${server.port}/v1/chat/completions`,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${key.key}`},body:JSON.stringify(body)});
        await result.text();
        if (tag === "blue") { expect({mode,sent}).toEqual({mode,sent:[]}); expect(result.status).not.toBe(200); }
        else { expect({mode,tag,status:result.status}).toEqual({mode,tag,status:200}); expect(sent.length).toBeGreaterThan(0); }
      }
    }
  } finally {server.stop(true);globalThis.fetch=original;}
},60000);

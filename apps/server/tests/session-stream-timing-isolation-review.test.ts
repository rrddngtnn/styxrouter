import "./helpers/test-secrets";
import { expect, test } from "bun:test";
import { createApiKey } from "../src/lib/db/apiKeys";
import { createProviderNode, createProviderConnection } from "../src/lib/db/providers";
import { clearSessions, getActiveSessions } from "../open-sse/services/sessionManager";
import { getToolLatencyByProvider, resetToolLatency } from "../open-sse/services/toolLatencyTracker";
import { initTranslators } from "../open-sse/translator/index";
import { handleChat } from "../src/sse/handlers/chat";

test("stream tool timing is consumed only by same key and generated conversations are isolated", async () => {
  clearSessions(); resetToolLatency(); await initTranslators();
  const node: any = await createProviderNode({type:"openai-compatible", name:"timingreview", prefix:"timingreview", apiType:"chat", baseUrl:"https://timingreview.example/v1"});
  await createProviderConnection({provider:node.id,authType:"apikey",apiKey:"synthetic-token"} as any);
  const a = await createApiKey("timing-a", "test"); const b = await createApiKey("timing-b", "test");
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any, options: any) => {
    if (String(url).startsWith("http://127.0.0.1:")) return realFetch(url, options);
    const payload = JSON.parse(options.body);
    const tool = payload.messages.length === 1;
    const frames = tool ? [
      {id:"fixture",object:"chat.completion.chunk",model:"fixture",choices:[{index:0,delta:{tool_calls:[{index:0,id:"call_1",type:"function",function:{name:"probe",arguments:"{}"}}]},finish_reason:null}]},
      {id:"fixture",object:"chat.completion.chunk",model:"fixture",choices:[{index:0,delta:{},finish_reason:"tool_calls"}]},
    ] : [
      {id:"fixture",object:"chat.completion.chunk",model:"fixture",choices:[{index:0,delta:{content:"done"},finish_reason:null}]},
      {id:"fixture",object:"chat.completion.chunk",model:"fixture",choices:[{index:0,delta:{},finish_reason:"stop"}]},
    ];
    return new Response(frames.map(x => `data: ${JSON.stringify(x)}\n\n`).join("") + "data: [DONE]\n\n", {headers:{"content-type":"text/event-stream"}});
  }) as typeof fetch;
  const server = Bun.serve({hostname:"127.0.0.1",port:0,fetch:handleChat});
  const send = async (key: string | null, follow: boolean) => {
    const response = await realFetch(`http://127.0.0.1:${server.port}/v1/chat/completions`,{method:"POST",headers:{"content-type":"application/json",...(key ? {authorization:`Bearer ${key}`} : {}),"x-session-id":"timing-shared"},body:JSON.stringify({model:"timingreview/fixture",stream:true,messages:[{role:"user",content:"hello"},...(follow ? [{role:"assistant",content:"prior"},{role:"tool",tool_call_id:"call_1",content:"result"}] : [])]})});
    expect(response.status).toBe(200); const id = response.headers.get("x-conversationid"); const text = await response.text(); expect(text).toContain("[DONE]"); return id;
  };
  try {
    const idA = await send(a.key, false); expect(idA).toBeTruthy();
    const idB = await send(b.key, true); const idPublic = await send(null, true);
    expect(new Set([idA,idB,idPublic]).size).toBe(3);
    expect(getActiveSessions()).toHaveLength(3);
    expect(JSON.stringify(getActiveSessions())).not.toContain(a.key);
    expect(JSON.stringify(getActiveSessions())).not.toContain(b.key);
    expect(Object.values(getToolLatencyByProvider()).reduce((n,x)=>n+x.measurementCount,0)).toBe(0);
    const again = await send(a.key, true); expect(again).toBe(idA);
    expect(Object.values(getToolLatencyByProvider()).reduce((n,x)=>n+x.measurementCount,0)).toBe(1);
    await send(a.key, true);
    expect(Object.values(getToolLatencyByProvider()).reduce((n,x)=>n+x.measurementCount,0)).toBe(1);
  } finally {server.stop(true);globalThis.fetch=realFetch;clearSessions();resetToolLatency();}
},60000);

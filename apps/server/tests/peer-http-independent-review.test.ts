import { expect, test } from "bun:test";
import { createProviderConnection, createProviderNode } from "../src/lib/db/providers";
import { initTranslators } from "../open-sse/translator/index";
import { handleChat } from "../src/sse/handlers/chat";

test("peer guard and forwarding through real HTTP", async () => {
  process.env.STYX_INSTANCE_ID = "local";
  process.env.STYX_PEER_MAX_HOPS = "4";
  await initTranslators();
  const seen: string[] = [];
  const upstream = Bun.serve({hostname:"127.0.0.1",port:0,fetch(req) {
    seen.push(req.headers.get("x-styxrouter-peer-trace") ?? "");
    return Response.json({id:"fixture",object:"chat.completion",model:"fixture",choices:[{index:0,message:{role:"assistant",content:"ok"},finish_reason:"stop"}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}});
  }});
  const baseUrl = `http://127.0.0.1:${upstream.port}/v1`;
  process.env.STYX_PEER_URLS = baseUrl;
  const node: any = await createProviderNode({type:"openai-compatible",name:"peerreview",prefix:"peerreview",apiType:"chat",baseUrl});
  await createProviderConnection({provider:node.id,authType:"apikey",apiKey:"synthetic-not-a-secret", providerSpecificData:{prefix:"peerreview",apiType:"chat",baseUrl}} as any);
  const server = Bun.serve({hostname:"127.0.0.1",port:0,fetch:(request) => handleChat(request)});
  const request = async (trace: string) => {
    const res = await fetch(`http://127.0.0.1:${server.port}/v1/chat/completions`, {method:"POST",headers:{"content-type":"application/json","x-styxrouter-peer-trace":trace},body:JSON.stringify({model:"peerreview/fixture",stream:false,messages:[{role:"user",content:"hi"}]})});
    return {status:res.status,body:await res.text()};
  };
  try {
    const huge = await request("other,".repeat(350));
    expect(huge.status).toBe(508); expect(seen).toEqual([]);
    const loop = await request("a,local"); expect(loop.status).toBe(508); expect(seen).toEqual([]);
    const limit = await request("a,b,c,d"); expect(limit.status).toBe(508); expect(seen).toEqual([]);
    const valid = await request("a,b"); expect(valid.status).toBe(200); expect(seen).toEqual(["a,b,local"]);
  } finally {server.stop(true);upstream.stop(true);}
},60000);

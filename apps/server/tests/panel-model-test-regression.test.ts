import "./helpers/test-secrets";
import { expect, test } from "bun:test";
import { createProviderNode, createProviderConnection } from "../src/lib/db/providers";
import { createApiKey, updateApiKeyPermissions } from "../src/lib/db/apiKeys";
import { addCustomModel } from "../src/lib/db/models";
import { getDbInstance } from "../src/lib/db/core";

test("dashboard test executes only with session and same origin, public inference remains key gated", async () => {
  process.env.INITIAL_PASSWORD = "fixture-panel-password";
  process.env.JWT_SECRET = "fixture-panel-secret-0123456789012345";
  let calls = 0;
  let hang = false;
  let upstreamAborted = false;
  let fail = false;
  const dispatchedModels: string[] = [];
  const upstream = Bun.serve({hostname:"127.0.0.1",port:0,async fetch(req) {
    calls++; const body = await req.json() as any;
    dispatchedModels.push(body.model);
    if (fail) return Response.json({error:{message:"PROBE_PERSISTED_SENTINEL_9467",code:"model_not_found"}}, {status:404});
    if (hang) return await new Promise<Response>((resolve) => {
      req.signal.addEventListener("abort", () => { upstreamAborted = true; resolve(new Response(null, {status: 499})); }, {once:true});
    });
    return Response.json({id:"fixture",object:"chat.completion",model:body.model,choices:[{index:0,message:{role:"assistant",content:"OK"},finish_reason:"stop"}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}});
  }});
  const node:any = await createProviderNode({type:"openai-compatible",name:"panelprobe",prefix:"panelprobe",apiType:"chat",baseUrl:`http://127.0.0.1:${upstream.port}/v1`});
  await addCustomModel(node.id, "fixture-model", "Fixture");
  await createProviderConnection({provider:node.id,authType:"apikey",apiKey:"synthetic-upstream-secret",providerSpecificData:{prefix:"panelprobe",apiType:"chat",baseUrl:`http://127.0.0.1:${upstream.port}/v1`}} as any);
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input:any, init:any) => { const url = input instanceof Request ? input.url : String(input); if (!url.startsWith("http://127.0.0.1:")) return Promise.reject(new Error("external network disabled")); return realFetch(input,init); }) as typeof fetch;
  const {default:config} = await import("../server/styx");
  const server = Bun.serve({...config,hostname:"127.0.0.1",port:0});
  const base = `http://127.0.0.1:${server.port}`;
  try {
    const login = await realFetch(base+"/api/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({password:process.env.INITIAL_PASSWORD})});
    expect(login.status).toBe(200); const cookie=login.headers.get("set-cookie")!.split(";")[0];
    const send=(path:string,headers:Record<string,string>={})=>realFetch(base+path,{method:"POST",headers:{"content-type":"application/json",...headers},body:JSON.stringify({model:"panelprobe/fixture-model"})});
    expect((await send("/v1/chat/completions",{cookie,origin:base})).status).toBe(401);
    expect((await send("/api/model-test",{origin:base})).status).toBe(401);
    expect((await send("/api/model-test",{cookie,origin:"http://evil.example"})).status).toBe(403);
    expect((await send("/api/model-test",{cookie})).status).toBe(403);
    expect((await send("/api/model-test",{cookie,origin:base.replace("http:","https:")})).status).toBe(403);
    const key = await createApiKey("restricted-panel-test", "test");
    await updateApiKeyPermissions(key.id, { modelAccessMode:"restricted", allowedModels:["other/allowed"] });
    const restricted = await realFetch(base+"/v1/chat/completions",{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${key.key}`},body:JSON.stringify({model:"panelprobe/fixture-model",messages:[{role:"user",content:"hi"}]})});
    expect(restricted.status).toBe(403);
    expect(calls).toBe(0);
    const unknown = await realFetch(base+"/api/model-test",{method:"POST",headers:{"content-type":"application/json",cookie,origin:base},body:JSON.stringify({model:"panelprobe/not-in-inventory"})});
    expect(unknown.status).toBe(400);
    expect(calls).toBe(0);
    const res = await send("/api/model-test",{cookie,origin:base});
    expect(res.status).toBe(200); const text=await res.text(); expect(text).not.toContain("synthetic-upstream-secret"); expect(JSON.parse(text).ok).toBe(true); expect(calls).toBe(1); expect(dispatchedModels).toEqual(["fixture-model"]);
    expect((await send("/api/model-test",{cookie,origin:base})).status).toBe(429);
    expect(calls).toBe(1);
    await Bun.sleep(5100);
    hang = true;
    const started = Date.now();
    const pending = send("/api/model-test",{cookie,origin:base});
    while (calls < 2 && Date.now() - started < 3000) await Bun.sleep(10);
    expect(calls).toBe(2);
    expect((await send("/api/model-test",{cookie,origin:base})).status).toBe(429);
    const stalled = await Promise.race([pending, Bun.sleep(16000).then(() => null)]);
    expect(stalled?.status).toBe(504);
    expect(Date.now() - started).toBeLessThan(16000);
    for (let i = 0; i < 100 && !upstreamAborted; i++) await Bun.sleep(10);
    expect(upstreamAborted).toBe(true);
    hang = false;
    expect((await send("/api/model-test",{cookie,origin:base})).status).toBe(200);
    expect(calls).toBe(3);
    await Bun.sleep(5100);
    fail = true;
    const failure = await send("/api/model-test",{cookie,origin:base,"x-route-model":"panelprobe/attacker"});
    expect(failure.ok).toBe(false);
    expect(await failure.text()).not.toContain("PROBE_PERSISTED_SENTINEL_9467");
    expect(dispatchedModels.slice(3)).toEqual(["fixture-model"]);
    await Bun.sleep(250);
    const db = getDbInstance();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as {name:string}[];
    for (const {name} of tables) {
      if (!/^[a-zA-Z0-9_]+$/.test(name)) continue;
      expect(JSON.stringify(db.prepare(`SELECT * FROM "${name}"`).all())).not.toContain("PROBE_PERSISTED_SENTINEL_9467");
    }
  } finally { server.stop(true); upstream.stop(true); globalThis.fetch=realFetch; }
},60000);

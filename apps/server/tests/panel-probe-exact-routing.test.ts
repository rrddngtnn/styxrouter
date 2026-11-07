import "./helpers/test-secrets";
import { expect, test } from "bun:test";
import { createApiKey } from "../src/lib/db/apiKeys";
import { createProviderConnection } from "../src/lib/db/providers";
import { initTranslators } from "../open-sse/translator/index";
import * as chat from "../src/sse/handlers/chat";

test("trusted probe dispatches its literal target despite a route header", async () => {
  await initTranslators();
  await createProviderConnection({ provider: "codebuddy-cn", authType: "oauth", accessToken: "synthetic-probe", isActive: true } as any);
  const key = await createApiKey("probe-routing", "test");
  const seen: string[] = [];
  const original = globalThis.fetch;
  try {
    globalThis.fetch = (async (_url, options) => {
      seen.push(JSON.parse(String(options?.body)).model);
      return new Response(JSON.stringify({id:"test",object:"chat.completion",choices:[{index:0,message:{role:"assistant",content:"ok"},finish_reason:"stop"}]}), {headers:{"content-type":"application/json"}});
    }) as typeof fetch;
    const req = new Request("http://localhost/v1/chat/completions", {method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${key.key}`,"x-route-model":"codebuddy-cn/attacker"},body:JSON.stringify({model:"codebuddy-cn/synthetic-exact-model",messages:[{role:"user",content:"hi"}],stream:false})});
    expect(typeof (chat as any).markExactTargetProbe).toBe("function");
    (chat as any).markExactTargetProbe(req, "codebuddy-cn/synthetic-exact-model");
    const response = await chat.handleChat(req);
    await response.text();
    expect(seen).toEqual(["synthetic-exact-model"]);
  } finally { globalThis.fetch = original; }
}, 60000);

test("a client-supplied probe header cannot activate exact-target routing", async () => {
  const key = await createApiKey("untrusted-probe", "test");
  const req = new Request("http://localhost/v1/chat/completions", {method:"POST", headers:{"content-type":"application/json", authorization:`Bearer ${key.key}`, "x-styx-exact-target-probe":"true", "x-route-model":"codebuddy-cn/attacker"}, body:JSON.stringify({model:"codebuddy-cn/synthetic-exact-model",messages:[{role:"user",content:"hi"}],stream:false})});
  const original = globalThis.fetch;
  const seen: string[] = [];
  try {
    globalThis.fetch = (async (_url, options) => { seen.push(JSON.parse(String(options?.body)).model); return new Response(JSON.stringify({id:"test",object:"chat.completion",choices:[{index:0,message:{role:"assistant",content:"ok"},finish_reason:"stop"}]}), {headers:{"content-type":"application/json"}}); }) as typeof fetch;
    const response = await chat.handleChat(req);
    await response.text();
    expect(seen).toEqual(["attacker"]);
  } finally { globalThis.fetch = original; }
}, 60000);

test("a failed exact probe never dispatches a sibling model", async () => {
  const key = await createApiKey("failed-probe", "test");
  const req = new Request("http://localhost/v1/chat/completions", {method:"POST", headers:{"content-type":"application/json", authorization:`Bearer ${key.key}`}, body:JSON.stringify({model:"codebuddy-cn/deepseek-v3.2",messages:[{role:"user",content:"hi"}],stream:false})});
  chat.markExactTargetProbe(req, "codebuddy-cn/deepseek-v3.2");
  const seen: string[] = [];
  const original = globalThis.fetch;
  try {
    globalThis.fetch = (async (_url, options) => { seen.push(JSON.parse(String(options?.body)).model); return new Response(JSON.stringify({error:{message:"model not found",type:"invalid_request_error",code:"model_not_found"}}), {status:404,headers:{"content-type":"application/json"}}); }) as typeof fetch;
    const response = await chat.handleChat(req);
    await response.text();
    expect(response.ok).toBe(false);
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen)).toEqual(new Set(["deepseek-v3.2"]));
  } finally { globalThis.fetch = original; }
}, 60000);

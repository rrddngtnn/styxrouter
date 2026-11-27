import './helpers/test-secrets';
import { describe, test, expect } from "bun:test";
import { getExecutor } from "../open-sse/executors/index.ts";
import { OpencodeExecutor } from "../open-sse/executors/opencode.ts";

describe("OpenCode existing entry wiring", () => {
  test("official inference paths are protocol-specific and connection overrides are preserved", () => {
    const executor = getExecutor("opencode-go") as OpencodeExecutor;
    for (const [format, suffix] of [["openai", "/openai/v1/chat/completions"], ["openai-responses", "/openai/v1/responses"], ["claude", "/anthropic/v1/messages"], ["gemini", "/google/v1beta/models/Exact.Model:generateContent"]]) {
      executor._requestFormat = format;
      expect(executor.buildUrl("Exact.Model", false)).toBe(`https://opencode.ai/inference/go${suffix}`);
    }
    executor._requestFormat = "openai";
    expect(executor.buildUrl("Exact.Model", false, 0, { providerSpecificData: { baseUrl: "https://custom.example/zen/v1" } })).toBe("https://custom.example/zen/v1/chat/completions");
    executor._requestFormat = null;
  });
  test("Messages uses Bearer and truthful identity; sessions stay stable and key-scoped", () => {
    const executor = getExecutor("opencode-go") as OpencodeExecutor;
    executor._requestFormat = "claude";
    const headers = (key: string) => executor.buildHeaders({ apiKey: "fixture-upstream" }, true, { authorization: `Bearer ${key}`, "x-opencode-session": "same-conversation" }, "Exact.Model");
    const first = headers("key-a");
    expect(first.Authorization).toBe("Bearer fixture-upstream");
    expect(first["x-api-key"]).toBeUndefined();
    expect(first["User-Agent"]).toBe("StyxRouter/1.0");
    expect(first["x-opencode-client"]).toBeUndefined();
    expect(first["x-opencode-session"]).toBe(headers("key-a")["x-opencode-session"]);
    expect(first["x-opencode-session"]).not.toBe(headers("key-b")["x-opencode-session"]);
    executor._requestFormat = null;
  });
  test("quota without an explicit supported endpoint stays unknown without a network call", async () => {
    const { fetchOpencodeQuota } = await import("../open-sse/services/opencodeQuotaFetcher.ts");
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => { calls++; return Response.json({ quota: { window_5h: { used: 0, limit: 12 } } }); }) as typeof fetch;
    try {
      expect(await fetchOpencodeQuota("synthetic-quota", { apiKey: "fixture" })).toBeNull();
      expect(calls).toBe(0);
    } finally { globalThis.fetch = original; }
  });
  test("all Console models require credentials; keyless free traffic never dispatches", async () => {
    const executor = getExecutor("opencode") as OpencodeExecutor;
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => { calls++; throw Error("unexpected dispatch"); }) as typeof fetch;
    try {
      const result = await executor.execute({ model: "big-pickle", body: { messages: [] }, credentials: {}, stream: false });
      expect(result.response.status).toBe(402);
      expect(calls).toBe(0);
    } finally { globalThis.fetch = original; }
  });
  test("credential manifests do not advertise anonymous Console access", async () => {
    const { NOAUTH_PROVIDERS, APIKEY_PROVIDERS } = await import("../src/shared/constants/providers.ts");
    expect(NOAUTH_PROVIDERS.opencode.noAuth).not.toBe(true);
    expect(APIKEY_PROVIDERS["opencode-go"].anonymousFallback).not.toBe(true);
    expect(APIKEY_PROVIDERS["opencode-zen"].anonymousFallback).not.toBe(true);
  });
  test("explicit caller output budgets are not silently raised", async () => {
    const executor = getExecutor("opencode-go") as OpencodeExecutor;
    const original = globalThis.fetch;
    globalThis.fetch = (async () => Response.json({error:{message:"fixture denied"}}, {status:403})) as typeof fetch;
    const body = {model:"muse-spark-1.2-contributor",input:[],max_tokens:12};
    try { await executor.execute({model:body.model,body,credentials:{apiKey:"fixture"},stream:false});expect(body.max_tokens).toBe(12); }
    finally {globalThis.fetch=original;}
  });
  test("concurrent native requests keep their own format across awaits", async () => {
    const { PROVIDER_MODELS } = await import("../open-sse/config/providerModels.ts");
    const prior = PROVIDER_MODELS["opencode-go"];
    PROVIDER_MODELS["opencode-go"] = [...prior, {id:"Concurrent.Chat",name:"Chat",targetFormat:"openai"}, {id:"Concurrent.Messages",name:"Messages",targetFormat:"claude"}];
    const executor = getExecutor("opencode-go") as OpencodeExecutor;
    const original = globalThis.fetch;
    const seen: Array<[string,string]> = [];
    globalThis.fetch = (async (url, init) => {
      const body = JSON.parse(typeof init?.body === "string" ? init.body : new TextDecoder().decode(init?.body as Uint8Array));
      seen.push([body.model,String(url)]);
      await new Promise(resolve => setTimeout(resolve,5));
      return Response.json({error:{message:"fixture denied"}}, {status:403});
    }) as typeof fetch;
    try {
      await Promise.all(["Concurrent.Chat","Concurrent.Messages"].map(model => executor.execute({model,body:{model,messages:[]},credentials:{apiKey:"fixture"},stream:false})));
      expect(seen).toContainEqual(["Concurrent.Chat","https://opencode.ai/inference/go/openai/v1/chat/completions"]);
      expect(seen).toContainEqual(["Concurrent.Messages","https://opencode.ai/inference/go/anthropic/v1/messages"]);
    } finally {globalThis.fetch=original;PROVIDER_MODELS["opencode-go"]=prior;}
  });
  test("auth and rate errors remain distinct with Retry-After and no model rewrite", async () => {
    const original = globalThis.fetch;
    try {
      for (const status of [401,403,429]) {
        let calls=0;
        globalThis.fetch=(async () => {calls++;return Response.json({error:{message:"synthetic failure",code:status===429?"rate_limit_exceeded":"permission_denied"}},{status,headers:{"retry-after":"7"}});}) as typeof fetch;
        const result=await new OpencodeExecutor("opencode-go").execute({model:"Exact.Model",body:{model:"Exact.Model",messages:[]},credentials:{apiKey:"fixture"},stream:false,skipUpstreamRetry:true});
        expect(result.response.status).toBe(status);expect(result.response.headers.get("retry-after")).toBe("7");expect(calls).toBe(1);
        expect((result.transformedBody as any).model).toBe("Exact.Model");
      }
    } finally {globalThis.fetch=original;}
  });
  test("oc uses the registered OpenCode executor instead of unsupported-provider/default", () => {
    expect(getExecutor("oc")).toBeInstanceOf(OpencodeExecutor);
  });
});

import { expect, test } from "bun:test";
import { prepareTokenImport, tokenImportProviders } from "../server/tokenImport.ts";
import { KimiWebExecutor, extractKimiAccessToken } from "../open-sse/executors/kimi-web.ts";

test("Kimi distinguishes opaque equals tokens from explicit cookie jars", () => {
  expect(extractKimiAccessToken("synthetic=opaque")).toBe("synthetic=opaque");
  expect(extractKimiAccessToken("synthetic==")).toBe("synthetic==");
  expect(extractKimiAccessToken("access_token=synthetic=value; other=ignored")).toBe("synthetic=value");
  expect(extractKimiAccessToken("Cookie: other=value")).toBe("");
  expect(extractKimiAccessToken("other=value; another=value")).toBe("");
});

test("Kimi web accepts access-only import but rejects refresh pairs", () => {
  expect(tokenImportProviders().find(p => p.id === "kimi-web")).toMatchObject({supported:true, access:true, accessRefresh:false, authType:"oauth"});
  expect(prepareTokenImport({provider:"kimi-web",accounts:{access_token:"synthetic-kimi-access"}})?.[0].view.valid).toBe(true);
  expect(prepareTokenImport({provider:"kimi-web",accounts:{access_token:"synthetic-kimi-access",refresh_token:"synthetic-kimi-refresh"}})?.[0].view.valid).toBe(false);
});

test("an import-valid opaque Kimi access token dispatches unchanged", async () => {
  const prepared = prepareTokenImport({provider:"codebuddy-cn",accounts:{access_token:"synthetic=opaque"}});
  expect(prepared?.[0].view.valid).toBe(true);
  const original = globalThis.fetch; let authorization = "";
  globalThis.fetch = (async (_input, init) => { authorization = new Headers(init?.headers).get("authorization") ?? ""; return new Response("", {status:403}); }) as typeof fetch;
  try {
    await new KimiWebExecutor().execute({model:"k3",body:{messages:[{role:"user",content:"hi"}]},credentials:{accessToken:"synthetic=opaque",providerSpecificData:{importedToken:true}},stream:false} as any);
    expect(authorization).toBe("Bearer synthetic=opaque");
  } finally { globalThis.fetch = original; }
});

test("imported Kimi 401 never exchanges even a supplied refresh token", async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = (async () => { calls++; return new Response("synthetic secret", {status:401}); }) as typeof fetch;
  try {
    const result = await new KimiWebExecutor().execute({model:"k3",body:{messages:[{role:"user",content:"hi"}]},credentials:{accessToken:"synthetic-kimi-access",refreshToken:"synthetic-kimi-refresh",providerSpecificData:{importedToken:true}},stream:false} as any);
    expect(result.response.status).toBe(401); expect(calls).toBe(1);
    expect(await result.response.text()).not.toContain("synthetic secret");
  } finally { globalThis.fetch = original; }
});

test("imported opaque token resembling a cookie pair is not reparsed", async () => {
  const original = globalThis.fetch; let authorization = "";
  globalThis.fetch = (async (_input, init) => { authorization = new Headers(init?.headers).get("authorization") ?? ""; return new Response("", { status: 403 }); }) as typeof fetch;
  try {
    await new KimiWebExecutor().execute({ model: "k3", body: { messages: [{ role: "user", content: "hi" }] }, credentials: { accessToken: "access_token=synthetic", providerSpecificData: { importedToken: true } }, stream: false } as any);
    expect(authorization).toBe("Bearer access_token=synthetic");
  } finally { globalThis.fetch = original; }
});

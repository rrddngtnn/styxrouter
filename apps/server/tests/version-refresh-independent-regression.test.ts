import { afterEach, expect, test } from "bun:test";
import { Hono } from "hono";
import { requireAuth } from "../server/auth.ts";
import { createAdminApi } from "../server/admin.ts";
import { getZcodeVersion, getCachedZcodeVersion, __resetZcodeVersionCacheForTesting } from "../open-sse/services/zcodeVersion.ts";
import { resolveAntigravityIdeVersion, resolveAntigravityCliVersion, clearAntigravityVersionCaches } from "../open-sse/services/antigravityVersion.ts";
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; __resetZcodeVersionCacheForTesting(); clearAntigravityVersionCaches(); });

test("ZCode stale source cannot downgrade last-good cache", async () => {
  globalThis.fetch = (async () => Response.json([{name:"9.0.0"}])) as typeof fetch;
  await getZcodeVersion();
  globalThis.fetch = (async () => Response.json([{name:"8.0.0"}])) as typeof fetch;
  await getZcodeVersion(true);
  expect(getCachedZcodeVersion()).toBe("9.0.0");
});

test("Antigravity timeout remains active while JSON body is consumed", async () => {
  let signal: AbortSignal | undefined;
  const fakeFetch = (async (_url: any, init: any) => {
    signal = init.signal;
    return { ok: true, json: () => new Promise((_resolve, reject) => signal!.addEventListener("abort", () => reject(new Error("aborted")))) } as Response;
  }) as typeof fetch;
  const result = resolveAntigravityIdeVersion(fakeFetch, true).then(() => "success", () => "failed");
  const observed = await Promise.race([result, new Promise<string>((resolve) => setTimeout(() => resolve("hung"), 5500))]);
  expect(observed).toBe("failed");
  expect(signal?.aborted).toBe(true);
}, 7000);

test("ZCode timeout remains active while consuming JSON", async () => {
  let signal: AbortSignal | undefined;
  globalThis.fetch = (async (_url: any, init: any) => {
    signal = init.signal;
    return {ok: true, json: () => new Promise((_resolve, reject) => signal!.addEventListener("abort", () => reject(new Error("aborted"))))} as Response;
  }) as typeof fetch;
  const result = getZcodeVersion(true).then(() => "success", () => "failed");
  expect(await Promise.race([result, new Promise<string>(resolve => setTimeout(() => resolve("hung"), 5500))])).toBe("failed");
  expect(signal?.aborted).toBe(true);
}, 7000);

test("unauthenticated refresh attempts cannot trigger network requests", async () => {
  let calls = 0;
  globalThis.fetch = (async () => { calls++; throw new Error("unexpected outbound request"); }) as typeof fetch;
  const app = new Hono();
  app.use("*", requireAuth);
  app.route("/api", createAdminApi());
  for (const provider of ["zcode", "antigravity"]) {
    const response = await app.request(`/api/versions/${provider}/refresh`, {method: "POST"});
    expect(response.status).toBe(401);
  }
  expect(calls).toBe(0);
});

test("concurrent refreshes share one request per source and use fixed credential-free URLs", async () => {
  const calls: Array<{url: string; init: RequestInit}> = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  globalThis.fetch = (async (input: any, init: RequestInit) => {
    calls.push({url: String(input), init});
    await gate;
    if (String(input).includes("zai-org")) return Response.json([{name:"4.0.0"}]);
    if (String(input).includes("antigravity-cli-auto-updater")) return Response.json({version:"1.3.0"});
    return Response.json([{version:"2.3.0"}]);
  }) as typeof fetch;
  const requests = [getZcodeVersion(true), getZcodeVersion(true), resolveAntigravityIdeVersion(fetch, true), resolveAntigravityIdeVersion(fetch, true), resolveAntigravityCliVersion(fetch, true), resolveAntigravityCliVersion(fetch, true)];
  release();
  expect(await Promise.all(requests)).toEqual(["4.0.0", "4.0.0", "2.3.0", "2.3.0", "1.3.0", "1.3.0"]);
  expect(calls.map(call => call.url).sort()).toEqual(["https://api.github.com/repos/zai-org/ZCode/tags", "https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/darwin_arm64.json", "https://antigravity-ide-auto-updater-974169037036.us-central1.run.app/releases"].sort());
  for (const call of calls) {
    expect(call.init.redirect).toBe("error");
    expect(new Headers(call.init.headers).has("authorization")).toBe(false);
    expect(new Headers(call.init.headers).has("cookie")).toBe(false);
  }
});

import { afterEach, expect, test } from "bun:test";
import { createAdminApi } from "../server/admin.ts";
import { clearAntigravityVersionCaches, seedAntigravityIdeVersionCache, seedAntigravityCliVersionCache, getCachedAntigravityIdeVersion, getCachedAntigravityCliVersion } from "../open-sse/services/antigravityVersion.ts";
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; clearAntigravityVersionCaches(); });
test("manual refresh bypasses fresh caches and publishes valid versions", async () => {
  seedAntigravityIdeVersionCache("2.1.1"); seedAntigravityCliVersionCache("1.1.5");
  const urls: string[] = [];
  globalThis.fetch = (async (input, init) => { urls.push(String(input)); expect(init?.redirect).toBe("error"); return String(input).includes("antigravity-cli-auto-updater") ? Response.json({version:"1.6.0"}) : Response.json([{version:"2.2.0"}]); }) as typeof fetch;
  const response = await createAdminApi().request("/versions/antigravity/refresh", {method:"POST"});
  expect(response.status).toBe(200);
  expect(getCachedAntigravityIdeVersion()).toBe("2.2.0");
  expect(getCachedAntigravityCliVersion()).toBe("1.6.0");
  expect(urls).toHaveLength(2);
});
test("source failure is reported without replacing last-good cache", async () => {
  seedAntigravityIdeVersionCache("2.5.0"); seedAntigravityCliVersionCache("1.5.0");
  globalThis.fetch = (async () => new Response("bad", {status:503})) as typeof fetch;
  const response = await createAdminApi().request("/versions/antigravity/refresh", {method:"POST"});
  expect(response.status).toBe(502);
  expect(getCachedAntigravityIdeVersion()).toBe("2.5.0"); expect(getCachedAntigravityCliVersion()).toBe("1.5.0");
});

test("partial failure reports each source and retains its cache", async () => {
  seedAntigravityIdeVersionCache("2.1.1"); seedAntigravityCliVersionCache("1.1.5");
  globalThis.fetch = (async (input) => String(input).includes("antigravity-cli-auto-updater") ? Response.json({version: "invalid"}) : Response.json([{version:"2.2.0"}])) as typeof fetch;
  const response = await createAdminApi().request("/versions/antigravity/refresh", {method:"POST"});
  expect(response.status).toBe(502);
  const result = await response.json();
  expect(result.failed).toEqual({ide:false, cli:true});
  expect(result.versions).toEqual({ide:"2.2.0", cli:"1.1.5"});
});

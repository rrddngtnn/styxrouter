import { afterEach, expect, test } from "bun:test";
import { createAdminApi } from "../server/admin.ts";
import { __resetZcodeVersionCacheForTesting, getCachedZcodeVersion, getZcodeVersion } from "../open-sse/services/zcodeVersion.ts";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; __resetZcodeVersionCacheForTesting(); });

test("manual refresh bypasses a fresh cache and updates dispatch version", async () => {
  __resetZcodeVersionCacheForTesting();
  let version = "4.0.0";
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return Response.json([{ name: version }]); }) as typeof fetch;
  expect(await getZcodeVersion()).toBe("4.0.0");
  version = "4.1.0";
  const response = await createAdminApi().request("/versions/zcode/refresh", { method: "POST" });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ previousVersion: "4.0.0", version: "4.1.0", updated: true });
  expect(getCachedZcodeVersion()).toBe("4.1.0");
  expect(calls).toBe(2);
});

test("failed refresh preserves the cached dispatch version and reports failure", async () => {
  __resetZcodeVersionCacheForTesting();
  globalThis.fetch = (async () => Response.json([{ name: "4.0.0" }])) as typeof fetch;
  await getZcodeVersion();
  globalThis.fetch = (async () => new Response("unavailable", { status: 503 })) as typeof fetch;
  const response = await createAdminApi().request("/versions/zcode/refresh", { method: "POST" });
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ error: "Version sources unavailable", previousVersion: "4.0.0" });
  expect(getCachedZcodeVersion()).toBe("4.0.0");
});

test("unofficial fallback and prerelease tags cannot replace last-good version", async () => {
  __resetZcodeVersionCacheForTesting();
  globalThis.fetch = (async () => Response.json([{ name: "4.0.0" }])) as typeof fetch;
  await getZcodeVersion();
  const urls: string[] = [];
  globalThis.fetch = (async (input) => { urls.push(String(input)); return String(input).includes("github.com") ? Response.json([{ name: "9.0.0-preview" }]) : Response.json({version:"10.0.0"}); }) as typeof fetch;
  const response = await createAdminApi().request("/versions/zcode/refresh", {method:"POST"});
  expect(response.status).toBe(502);
  expect(getCachedZcodeVersion()).toBe("4.0.0");
  expect(urls).toHaveLength(1);
});

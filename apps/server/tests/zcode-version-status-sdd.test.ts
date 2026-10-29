import { afterEach, expect, test } from "bun:test";
import { createAdminApi } from "../server/admin";
import { __resetZcodeVersionCacheForTesting, getZcodeVersion } from "../open-sse/services/zcodeVersion";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; __resetZcodeVersionCacheForTesting(); });

test("ZCode status distinguishes an observed upstream version from the retained dispatch version", async () => {
  __resetZcodeVersionCacheForTesting();
  const api = createAdminApi();
  const before = await api.request("/versions/zcode/status");
  expect(before.status).toBe(200);
  expect(before.headers.get("cache-control")).toBe("no-store");
  expect(await before.json()).toMatchObject({ observedVersion: null, observedAt: null });
  globalThis.fetch = (async () => Response.json([{ name: "9.0.0" }])) as typeof fetch;
  await getZcodeVersion(true);
  globalThis.fetch = (async () => Response.json([{ name: "8.0.0" }])) as typeof fetch;
  await getZcodeVersion(true);
  const response = await api.request("/versions/zcode/status");
  const result = await response.json();
  expect(result).toMatchObject({ observedVersion: "8.0.0", cachedVersion: "9.0.0", pinnedVersion: null, effectiveVersion: "9.0.0" });
  expect(result.observedAt).toBeGreaterThan(0);
  globalThis.fetch = (async () => new Response("fail", { status: 503 })) as typeof fetch;
  await expect(getZcodeVersion(true)).rejects.toThrow();
  const afterFailure = await (await api.request("/versions/zcode/status")).json();
  expect(afterFailure.observedVersion).toBe("8.0.0");
  expect(afterFailure.observedAt).toBe(result.observedAt);
  const pin = await api.request("/versions/zcode/pin", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({version: "2.0.0"}) });
  expect(pin.status).toBe(200);
  const pinned = await (await api.request("/versions/zcode/status")).json();
  expect(pinned).toMatchObject({ pinnedVersion: "2.0.0", effectiveVersion: "2.0.0", observedVersion: "8.0.0" });
});

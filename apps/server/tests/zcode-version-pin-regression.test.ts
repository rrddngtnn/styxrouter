import { afterAll, expect, test } from "bun:test";
import { Hono } from "hono";
import { createAdminApi } from "../server/admin.ts";
import { buildGlmCodingHeaders, buildZcodeStartPlanHeaders } from "../open-sse/config/glmProvider.ts";
import { requireAuth } from "../server/auth.ts";
import { __resetZcodeVersionCacheForTesting } from "../open-sse/services/zcodeVersion.ts";

const originalFetch = globalThis.fetch;
afterAll(() => { globalThis.fetch = originalFetch; __resetZcodeVersionCacheForTesting(); });

test("ZCode version pin overrides dispatch while refresh tracks upstream; clearing resumes tracking", async () => {
  globalThis.fetch = (async () => Response.json([{name: "9.2.1"}])) as typeof fetch;
  const app = new Hono();
  app.route("/api", createAdminApi());
  const put = (version: unknown) => app.request("/api/versions/zcode/pin", { method: "PUT", headers: {"content-type": "application/json"}, body: JSON.stringify({version}) });
  expect((await put("2.3.4")).status).toBe(200);
  expect(buildGlmCodingHeaders("synthetic")["X-ZCode-App-Version"]).toBe("2.3.4");
  expect(buildZcodeStartPlanHeaders("synthetic")["X-ZCode-App-Version"]).toBe("2.3.4");
  expect(await (await app.request("/api/versions/zcode/pin")).json()).toEqual({version:"2.3.4"});
  const refresh = await app.request("/api/versions/zcode/refresh", {method: "POST"});
  expect(refresh.status).toBe(200);
  expect((await refresh.json() as any).version).toBe("9.2.1");
  expect(buildGlmCodingHeaders("synthetic")["User-Agent"]).toBe("ZCode-CLI/2.3.4");
  expect((await put("bad\r\nheader")).status).toBe(400);
  expect(buildGlmCodingHeaders("synthetic")["X-ZCode-App-Version"]).toBe("2.3.4");
  expect((await put(null)).status).toBe(200);
  expect(buildGlmCodingHeaders("synthetic")["X-ZCode-App-Version"]).toBe("9.2.1");
});

test("version pin endpoints require an admin session", async () => {
  const app = new Hono();
  app.use("*", requireAuth);
  app.route("/api", createAdminApi());
  for (const method of ["GET", "PUT"]) {
    const response = await app.request("/api/versions/zcode/pin", {method});
    expect(response.status).toBe(401);
  }
});

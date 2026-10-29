import { expect, test } from "bun:test";
import { exchangeKimiRefreshToken } from "../src/lib/kimi/tokenRefresh.ts";
import { checkKimiWebConnectionIfNeeded } from "../src/lib/tokenHealthCheckKimi.ts";

const secret = "synthetic-unlabelled-refresh-09271";
const original = globalThis.fetch;
for (const mode of ["body", "fetch", "read", "json"] as const) {
  test(`Kimi refresh ${mode} errors never disclose upstream secrets`, async () => {
    globalThis.fetch = (async () => {
      if (mode === "fetch") throw new Error(`transport ${secret}`);
      if (mode === "read") return new Response(new ReadableStream({ start(c) { c.error(new Error(secret)); } }), { status: 403 });
      if (mode === "json") return new Response(`invalid json ${secret}`);
      return new Response(`unlabelled ${secret}`, { status: 403 });
    }) as typeof fetch;
    try {
      const result = await exchangeKimiRefreshToken(secret, "https://example.invalid");
      expect(result.success).toBe(false);
      expect(JSON.stringify(result)).not.toContain(secret);
    } finally { globalThis.fetch = original; }
  });
}

test("Kimi health logs do not expose labels or injected refresh errors", async () => {
  const logs: string[] = [];
  const conn = { id: "id", provider: "kimi-web", refreshToken: secret, apiKey: `e30.${Buffer.from(JSON.stringify({ exp: 1 })).toString("base64url")}.sig` };
  for (const success of [false, true]) {
    await checkKimiWebConnectionIfNeeded({ conn, now: "", log: (...x) => logs.push(x.join(" ")), logWarn: (...x) => logs.push(x.join(" ")), logError: (...x) => logs.push(x.join(" ")), getConnectionLogLabel: () => secret, logPrefix: "health", jitterSecFn: () => 240, exchangeFn: async () => success ? { success: true, accessToken: "new-access", refreshToken: secret } : { success: false, error: `failure ${secret}` }, persistFn: async () => ({} as any) });
  }
  expect(logs.length).toBeGreaterThan(0);
  expect(logs.some(s => s.includes("refreshed successfully"))).toBe(true);
  expect(logs.join("\n")).not.toContain(secret);
});

test("Kimi health does not log success before persistence", async () => {
  const logs: string[] = [];
  const conn = { id: "id", provider: "kimi-web", refreshToken: secret, apiKey: `e30.${Buffer.from(JSON.stringify({ exp: 1 })).toString("base64url")}.sig` };
  await expect(checkKimiWebConnectionIfNeeded({ conn, now: "", log: (...x) => logs.push(x.join(" ")), logWarn: (...x) => logs.push(x.join(" ")), logError: (...x) => logs.push(x.join(" ")), getConnectionLogLabel: () => secret, logPrefix: "health", jitterSecFn: () => 240, exchangeFn: async () => ({ success: true, accessToken: "new-access" }), persistFn: async () => { throw new Error("write failed"); } })).rejects.toThrow("write failed");
  expect(logs.join("\n")).not.toContain("refreshed successfully");
});

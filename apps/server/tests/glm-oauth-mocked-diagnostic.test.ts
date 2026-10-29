import { test, expect } from "bun:test";
import { zaiGlmProvider, ZAI_GLM_CONFIG } from "../src/lib/oauth/providers/zai-glm.ts";

test("GLM device bootstrap retains poll secret and returns pending from mocked upstream", async () => {
  const original = globalThis.fetch;
  const calls: { url: string; method: string; authorized: boolean }[] = [];
  globalThis.fetch = (async (url: any, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? "GET", authorized: Boolean(new Headers(init?.headers).get("authorization")) });
    if (calls.length === 1) return Response.json({ code: 0, data: { flow_id: "fixture-flow", authorize_url: "https://example.invalid/authorize", poll_interval_sec: 3 } });
    return Response.json({ code: 0, data: { status: "pending" } });
  }) as typeof fetch;
  try {
    const device = await zaiGlmProvider.requestDeviceCode();
    const result = await zaiGlmProvider.pollToken(ZAI_GLM_CONFIG, device.device_code, device);
    expect(result.data.error).toBe("authorization_pending");
    expect(calls).toEqual([
      { url: ZAI_GLM_CONFIG.cliInitUrl, method: "POST", authorized: true },
      { url: `${ZAI_GLM_CONFIG.cliPollUrl}/fixture-flow`, method: "GET", authorized: true },
    ]);
  } finally { globalThis.fetch = original; }
});

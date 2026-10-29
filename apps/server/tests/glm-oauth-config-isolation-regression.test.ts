import { expect, test } from "bun:test";
import { zaiGlmProvider } from "../src/lib/oauth/providers/zai-glm.ts";

test("GLM init and poll use the supplied config and the same poll secret", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const cfg = { ...zaiGlmProvider.config, providerId: "fixture", cliInitUrl: "https://fixture.invalid/init", cliPollUrl: "https://fixture.invalid/poll" };
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return Response.json(calls.length === 1
      ? { code: 0, data: { flow_id: "flow/one", authorize_url: "https://fixture.invalid/authorize" } }
      : { code: 0, data: { status: "pending" } });
  }) as typeof fetch;
  try {
    const device = await zaiGlmProvider.requestDeviceCode(cfg);
    const result = await zaiGlmProvider.pollToken(cfg, device.device_code, device);
    expect(result.data.error).toBe("authorization_pending");
    expect(calls.map(call => call.url)).toEqual(["https://fixture.invalid/init", "https://fixture.invalid/poll/flow%2Fone"]);
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ provider: "fixture" });
    expect(new Headers(calls[1].init?.headers).get("authorization")).toBe(new Headers(calls[0].init?.headers).get("authorization"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

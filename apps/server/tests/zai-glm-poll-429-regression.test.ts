import "./helpers/test-secrets";
import { afterEach, expect, test } from "bun:test";
import { zaiGlmProvider, ZAI_GLM_CONFIG } from "../src/lib/oauth/providers/zai-glm.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("zaiGlmProvider.pollToken treats HTTP 429 as slow_down instead of fatal access_denied", async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ msg: "Too Many Requests" }), {
      status: 429,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;

  const res = await zaiGlmProvider.pollToken(ZAI_GLM_CONFIG, "flow-123", {
    _zcodePollToken: "poll-secret-token",
  });

  expect(res.ok).toBe(true);
  expect(res.data.error).toBe("slow_down");
});

test("zaiGlmProvider.pollToken treats HTTP 5xx as authorization_pending instead of fatal access_denied", async () => {
  globalThis.fetch = (async () =>
    new Response("Bad Gateway", { status: 502 })) as unknown as typeof fetch;

  const res = await zaiGlmProvider.pollToken(ZAI_GLM_CONFIG, "flow-123", {
    _zcodePollToken: "poll-secret-token",
  });

  expect(res.ok).toBe(true);
  expect(res.data.error).toBe("authorization_pending");
});

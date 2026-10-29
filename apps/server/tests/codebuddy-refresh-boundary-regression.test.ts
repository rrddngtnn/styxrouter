import { expect, test } from "bun:test";
import { refreshCodebuddyCnToken } from "../open-sse/services/tokenRefresh/providers/codebuddyCn.ts";
import { refreshAccessToken, getAccessToken } from "../open-sse/services/tokenRefresh.ts";

test("CBCN unbound raw and generic refresh cannot send an unknown token", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return Response.json({ code: 0, data: { accessToken: "new" } }); }) as typeof fetch;
  try {
    for (const operation of [
      () => refreshCodebuddyCnToken("old", null),
      () => refreshAccessToken("codebuddy-cn", "old", {}, null),
      () => refreshAccessToken("cbcn", "old", {}, null),
      () => getAccessToken("codebuddy-cn", { refreshToken: "old" }, null),
    ]) {
      await expect(operation()).rejects.toThrow(/context.*required/i);
    }
    expect(calls).toBe(0);
  } finally { globalThis.fetch = original; }
});

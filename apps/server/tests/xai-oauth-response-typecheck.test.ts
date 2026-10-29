import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { XaiExecutor } from "../open-sse/executors/xai.ts";

test("xAI OAuth token response is typechecked", () => {
  const root = resolve(import.meta.dir, "../../..");
  const result = Bun.spawnSync([
    resolve(root, "apps/panel/node_modules/.bin/tsc"),
    "--noEmit", "--pretty", "false", "-p", resolve(root, "apps/server/tsconfig.json"),
  ], { cwd: root, stdout: "pipe", stderr: "pipe" });
  expect([0, 2]).toContain(result.exitCode);
  const output = new TextDecoder().decode(result.stdout);
  expect(output.split("\n").filter((line) => /open-sse\/executors\/xai\.ts\(.*error TS/.test(line))).toEqual([]);
}, 120_000);

test("xAI OAuth rejects malformed tokens and preserves refresh token fallback", async () => {
  const originalFetch = globalThis.fetch;
  try {
    let body: unknown = { access_token: 42 };
    globalThis.fetch = async () => Response.json(body);
    const executor = new XaiExecutor("xai-oauth");
    const credentials = { refreshToken: "old" };
    expect(await executor.refreshCredentials(credentials)).toBeNull();
    body = { access_token: "valid", refresh_token: { invalid: true }, expires_in: 60 };
    const refreshed = await executor.refreshCredentials(credentials);
    expect(refreshed?.accessToken).toBe("valid");
    expect(refreshed?.refreshToken).toBe("old");
    expect(typeof refreshed?.expiresAt).toBe("string");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

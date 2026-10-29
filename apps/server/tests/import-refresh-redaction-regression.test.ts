import { expect, test } from "bun:test";
import { refreshCodexToken } from "../open-sse/services/tokenRefresh/providers/codex.ts";
import { refreshClaudeOAuthToken } from "../open-sse/services/tokenRefresh/providers/claudeOAuth.ts";
import { refreshKimiCodingToken } from "../open-sse/services/tokenRefresh/providers/kimiCoding.ts";

const adapters = [
  ["codex", (log: any) => refreshCodexToken("synthetic-refresh-secret", log)],
  ["claude", (log: any) => refreshClaudeOAuthToken("synthetic-refresh-secret", log)],
  ["kimi", (log: any) => refreshKimiCodingToken("synthetic-refresh-secret", null, log)],
] as const;
for (const [name, refresh] of adapters) {
  test(`${name} never exposes untrusted refresh failures in logs or result`, async () => {
    const original = globalThis.fetch;
    const messages: unknown[] = [];
    const log = { info: (...args: unknown[]) => messages.push(args), warn: (...args: unknown[]) => messages.push(args), error: (...args: unknown[]) => messages.push(args) };
    try {
      for (const status of [401, 500]) {
        globalThis.fetch = (async () => Response.json({ error: { code: "synthetic-upstream-secret" }, extra: "synthetic-upstream-secret" }, { status })) as typeof fetch;
        const result = await refresh(log);
        expect(JSON.stringify([messages, result])).not.toContain("synthetic-upstream-secret");
      }
      globalThis.fetch = (async () => { throw new Error("synthetic-network-secret"); }) as typeof fetch;
      const result = await refresh(log);
      expect(JSON.stringify([messages, result])).not.toContain("synthetic-network-secret");
    } finally { globalThis.fetch = original; }
  });
  test(`${name} rejects malformed token responses without exposing them`, async () => {
    const original = globalThis.fetch;
    const messages: unknown[] = [];
    const log = { info: (...args: unknown[]) => messages.push(args), warn: (...args: unknown[]) => messages.push(args), error: (...args: unknown[]) => messages.push(args) };
    try {
      for (const data of [
        { access_token: { value: "synthetic-upstream-secret" }, refresh_token: "rotated", expires_in: 60 },
        { access_token: "valid", refresh_token: { value: "synthetic-upstream-secret" }, expires_in: 60 },
        { access_token: "valid", refresh_token: "rotated", expires_in: "synthetic-upstream-secret" },
      ]) {
        globalThis.fetch = (async () => Response.json(data)) as typeof fetch;
        expect(await refresh(log)).toBeNull();
      }
      expect(JSON.stringify(messages)).not.toContain("synthetic-upstream-secret");
    } finally { globalThis.fetch = original; }
  });
}

test("xAI OAuth does not log network exception details", async () => {
  const { XaiExecutor } = await import("../open-sse/executors/xai.ts");
  const original = globalThis.fetch;
  const messages: unknown[] = [];
  globalThis.fetch = (async () => { throw new Error("synthetic-network-secret"); }) as typeof fetch;
  try {
    const result = await new XaiExecutor("xai-oauth").refreshCredentials({ refreshToken: "synthetic-refresh" }, { warn: (...args: unknown[]) => messages.push(args) });
    expect(result).toBeNull();
    expect(JSON.stringify(messages)).not.toContain("synthetic-network-secret");
  } finally { globalThis.fetch = original; }
});

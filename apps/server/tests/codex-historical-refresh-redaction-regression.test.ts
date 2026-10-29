import { expect, test } from "bun:test";
import { refreshAccessToken } from "../open-sse/services/tokenRefresh.ts";

test("generic Codex refresh never logs upstream secrets for historical unmarked rows", async () => {
  const original = globalThis.fetch;
  const messages: unknown[] = [];
  const log = { error: (...args: unknown[]) => messages.push(args), warn: (...args: unknown[]) => messages.push(args), info: (...args: unknown[]) => messages.push(args) };
  try {
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: "invalid_grant", detail: "synthetic-secret-upstream-body" }), { status: 400 })) as typeof fetch;
    expect(await refreshAccessToken("codex", "synthetic-refresh", {}, log)).toMatchObject({ error: "unrecoverable_refresh_error" });
    globalThis.fetch = (async () => { throw new Error("synthetic-secret-network-exception"); }) as typeof fetch;
    expect(await refreshAccessToken("codex", "synthetic-refresh", {}, log)).toBeNull();
    expect(JSON.stringify(messages)).not.toContain("synthetic-secret");
  } finally { globalThis.fetch = original; }
});

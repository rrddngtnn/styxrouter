import { expect, test } from "bun:test";
import { GrokCliExecutor } from "../open-sse/executors/grok-cli.ts";
import { TraeExecutor } from "../open-sse/executors/trae.ts";
import { KiroExecutor } from "../open-sse/executors/kiro.ts";
import { GithubExecutor } from "../open-sse/executors/github.ts";
import { AntigravityExecutor } from "../open-sse/executors/antigravity.ts";

test("direct executor refresh rejects imported credentials before any network request", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls++; throw new Error("unexpected fetch"); }) as typeof fetch;
  const credentials: any = { accessToken: "synthetic-access", refreshToken: "synthetic-refresh", providerSpecificData: { importedToken: true } };
  try {
    for (const executor of [new GrokCliExecutor(), new TraeExecutor(), new KiroExecutor(), new GithubExecutor(), new AntigravityExecutor()]) {
      await expect(executor.refreshCredentials(credentials, null)).rejects.toThrow(/imported credential refresh.*disabled/i);
    }
    expect(calls).toBe(0);
  } finally { globalThis.fetch = original; }
});

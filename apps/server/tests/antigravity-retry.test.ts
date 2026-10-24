import { expect, test, spyOn } from "bun:test";
import { classify429, decide429 } from "../open-sse/services/antigravity429Engine.ts";
import { AntigravityExecutor } from "../open-sse/executors/antigravity.ts";

const genericMessage = "Resource has been exhausted (e.g. check quota).";

function context(message = genericMessage, retryCount = 0, headers: Record<string, string> = {}, status = 429) {
  return {
    response: Response.json({ error: { code: status, status: "RESOURCE_EXHAUSTED", message } }, { status, headers }),
    url: "https://example.invalid/generate", model: "gemini-3-flash",
    headers: {}, finalHeaders: {}, transformedBody: {}, credentials: {},
    stream: false, signal: undefined, log: { debug() {}, info() {}, warn() {}, error() {} },
    accountId: "retry-test", creditsMode: "off" as const, creditsRetryState: { attempted: false },
    urlIndex: 0, retryAttemptsByUrl: { 0: retryCount }, fallbackCount: 1,
  };
}

async function withoutWaiting(run: (waits: number[]) => Promise<void>) {
  const waits: number[] = [];
  const timer = spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, ms: number) => {
    waits.push(ms);
    callback();
    return 0;
  }) as typeof setTimeout);
  try { await run(waits); } finally { timer.mockRestore(); }
}

test("generic RESOURCE_EXHAUSTED retries once then returns 429 for account failover without quota lock", async () => {
  expect(classify429(genericMessage)).toBe("unknown");
  expect(decide429("unknown", null).kind).toBe("soft_retry");
  const executor = new AntigravityExecutor();
  const ctx = context();
  await withoutWaiting(async (waits) => {
    expect((await executor.handleAntigravityRateLimit(ctx)).action).toBe("retrySameUrl");
    expect(ctx.retryAttemptsByUrl[0]).toBe(1);
    const outcome = await executor.handleAntigravityRateLimit(ctx);
    expect(outcome.action).toBe("fallthrough");
    expect(outcome).toEqual({ action: "fallthrough", retryMs: 5000, lastStatus: 429 });
    expect(ctx.retryAttemptsByUrl[0]).toBe(1);
    expect(waits).toEqual([5000]);
    expect(ctx.creditsRetryState.attempted).toBe(false);
    expect(ctx.response.status).toBe(429);
    expect(await ctx.response.json()).toEqual({ error: { code: 429, status: "RESOURCE_EXHAUSTED", message: genericMessage } });
  });
});

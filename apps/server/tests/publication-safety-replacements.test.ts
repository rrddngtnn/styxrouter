import { expect, test } from "bun:test";
import pino from "pino";

test("replacement is exercised through the real pino logMethod hook", async () => {
  const { redactLogArgs } = await import("../src/shared/utils/logRedaction.ts");
  const lines: string[] = [];
  const logger = pino({ hooks: { logMethod(args, method) { method.apply(this, redactLogArgs(args) as Parameters<typeof method>); } } }, { write(line) { lines.push(line); } });
  logger.info({ password: "structured-secret", err: new Error("Bearer abcdefghijklmnop") }, "api_key=message-secret");
  const entry = JSON.parse(lines[0]);
  expect(entry.password).toBe("[REDACTED]");
  expect(entry.err.message).not.toContain("abcdefghijklmnop");
  expect(entry.msg).not.toContain("message-secret");
});

// Behavior contracts, not source-equivalence tests. The previous attributed
// implementations are intentionally excluded before exercising these contracts.
async function load(path: string) {
  const module = await import(path).catch(() => null);
  expect(module).not.toBeNull();
  return module!;
}

test("log safety scrubs messages, structured credentials and errors without mutation", async () => {
  const { redactSecrets, redactLogArgs } = await load("../src/shared/utils/logRedaction.ts");
  const secrets = ["abcdefghi123456789", "sk-proj-abcdefghijk123456789", "123456:abcdefghijklmnopqrstuvw"];
  const input = `Authorization: Bearer ${secrets[0]} api_key=${secrets[0]} ${secrets[1]} https://api.telegram.org/bot${secrets[2]}/getMe`;
  for (const secret of secrets) expect(redactSecrets(input)).not.toContain(secret);
  const object = { nested: { password: "short", authorization: "Basic abc", cookie: "session=x" }, message: input };
  const error = new Error(input);
  const result = redactLogArgs([object, error]);
  expect(JSON.stringify(result)).not.toContain("short");
  expect(JSON.stringify(result)).not.toContain("session=x");
  expect(result[1]).toBeInstanceOf(Error);
  expect((result[1] as Error).message).not.toContain(secrets[0]);
  expect((result[1] as Error).stack).not.toContain(secrets[0]);
  expect(object.nested.password).toBe("short");
  expect(error.message).toBe(input);
  const clean = ["hello", { value: 3 }, new Error("ordinary")];
  expect(redactLogArgs(clean)).toBe(clean);
});

test("log traversal fails closed at cycles, accessors, depth and node bounds", async () => {
  const { redactLogArgs } = await load("../src/shared/utils/logRedaction.ts");
  const cycle: any = { password: "cycle-secret" }; cycle.self = cycle;
  const deep: any = {}; let node = deep;
  for (let i = 0; i < 20; i++) { node.child = {}; node = node.child; }
  node.password = "deep-secret";
  const accessor = Object.defineProperty({}, "value", { enumerable: true, get() { throw new Error("getter executed"); } });
  const wide = Array.from({ length: 2500 }, () => ({ password: "wide-secret" }));
  const text = JSON.stringify(redactLogArgs([cycle, deep, accessor, wide, "Bearer abcdefghijklmnop"]));
  for (const secret of ["cycle-secret", "deep-secret", "wide-secret", "abcdefghijklmnop"]) expect(text).not.toContain(secret);
});

test("logger hook strips custom serialization and nested error causes", async () => {
  const { redactLogArgs } = await load("../src/shared/utils/logRedaction.ts");
  const value = { toJSON() { return "serialization-secret"; } };
  expect(JSON.stringify(redactLogArgs([value]))).not.toContain("serialization-secret");
  const error = new Error("outer", { cause: new Error("Bearer abcdefghijklmnop") });
  const safe = redactLogArgs([error])[0] as Error;
  expect((safe.cause as Error).message).not.toContain("abcdefghijklmnop");
});

test("sliding windows deny boundary bursts, atomically acquire scopes and refund unused leases", async () => {
  const { SlidingWindowLimiter } = await load("../open-sse/services/slidingWindowLimiter.ts");
  let now = 0;
  const limiter = new SlidingWindowLimiter({ now: () => now });
  const window = { requests: 2, windowMs: 100 };
  expect(limiter.tryAcquire("a", window).allowed).toBe(true);
  now = 99;
  expect(limiter.tryAcquire("a", window).allowed).toBe(true);
  expect(limiter.tryAcquire("a", window)).toEqual({ allowed: false, retryAfterMs: 1 });
  expect(limiter.tryAcquireMany([{ key: "b", window }, { key: "a", window }]).allowed).toBe(false);
  expect(limiter.tryAcquire("b", { requests: 1, windowMs: 100 }).allowed).toBe(true);
  now = 100;
  const result = limiter.tryAcquireMany([{ key: "a", window }, { key: "c", window }]);
  expect(result.allowed).toBe(true);
  result.lease.release(); result.lease.release();
  expect(limiter.tryAcquire("a", window).allowed).toBe(true);
  expect(limiter.tryAcquire("a", window).allowed).toBe(false);
  limiter.reset("a");
  expect(limiter.tryAcquire("a", window).allowed).toBe(true);
  limiter.reset();
  expect(limiter.tryAcquire("b", window).allowed).toBe(true);
});

test("limiter key pressure never evicts active security history", async () => {
  const { SlidingWindowLimiter } = await load("../open-sse/services/slidingWindowLimiter.ts");
  let now = 0;
  const limiter = new SlidingWindowLimiter({ now: () => now });
  const window = { requests: 1, windowMs: 100 };
  for (let i = 0; i < 5000; i++) expect(limiter.tryAcquire(String(i), window).allowed).toBe(true);
  expect(limiter.tryAcquire("overflow", window).allowed).toBe(false);
  expect(limiter.tryAcquire("0", window).allowed).toBe(false);
  now = 100;
  expect(limiter.tryAcquire("overflow", window).allowed).toBe(true);
});

test("provider budgets preserve NVIDIA defaults, overrides and per-connection isolation", async () => {
  const m = await load("../open-sse/services/providerDefaultRateLimit.ts");
  expect(m.getProviderDefaultRateLimit("nvidia")).toEqual({ requests: 40, windowMs: 60000 });
  expect(m.getProviderConcurrencyCap("nvidia", 1)).toBe(6);
  expect(m.getProviderDefaultRateLimit("unconfigured")).toBeUndefined();
  m.setProviderQuotaOverrides({ nvidia: { rpm: 3, concurrency: 2 } });
  expect(m.getProviderDefaultRateLimit("nvidia").requests).toBe(3);
  expect(m.getProviderConcurrencyCap("nvidia", 1)).toBe(2);
  m.setProviderQuotaOverrides(null);
  m.__setProviderDefaultRateLimitsForTests({ test: { requests: 1, windowMs: 30 } });
  expect(m.acquireProviderDefaultSlot("test", "one")).toBe(0);
  expect(m.acquireProviderDefaultSlot("test", "one")).toBeGreaterThan(0);
  expect(m.acquireProviderDefaultSlot("test", "two")).toBe(0);
  await m.awaitProviderDefaultSlot("test", "one", null, 100);
  const controller = new AbortController(); controller.abort();
  await expect(m.awaitProviderDefaultSlot("test", "one", controller.signal)).rejects.toHaveProperty("name", "AbortError");
  m.__setProviderDefaultRateLimitsForTests(null);
});

test("provider wait aborts while queued and cannot bypass its cap on deadline", async () => {
  const m = await load("../open-sse/services/providerDefaultRateLimit.ts");
  m.__setProviderDefaultRateLimitsForTests({ test: { requests: 1, windowMs: 100 } });
  m.acquireProviderDefaultSlot("test", "deadline");
  await expect(m.awaitProviderDefaultSlot("test", "deadline", null, 1)).rejects.toHaveProperty("name", "TimeoutError");
  expect(m.acquireProviderDefaultSlot("test", "deadline")).toBeGreaterThan(0);
  const controller = new AbortController();
  const wait = m.awaitProviderDefaultSlot("test", "deadline", controller.signal, 200);
  controller.abort();
  await expect(wait).rejects.toHaveProperty("name", "AbortError");
  m.__setProviderDefaultRateLimitsForTests(null);
});

test("no-thinking request and catalog compatibility are independent of upstream encoding", async () => {
  const m = await load("../open-sse/utils/noThinkingAlias.ts");
  expect(m.isNoThinkingAlias(null)).toBe(false);
  expect(m.toNoThinkingAlias("p/model")).toBe("no-think/p/model");
  expect(m.stripNoThinkingAlias("p/model")).toBe("p/model");
  expect(m.applyNoThinkingAlias({ model: "no-think/" }).applied).toBe(false);
  const body: any = { model: "no-think/p/model", reasoning: { effort: "high" }, reasoning_effort: "high" };
  expect(m.applyNoThinkingAlias(body)).toEqual({ applied: true, realModel: "p/model" });
  expect(body.reasoning_effort).toBe("none"); expect(body.reasoning).toBeUndefined();
  const claude: any = { model: "no-think/p/model", reasoning_effort: "high" };
  m.applyNoThinkingAlias(claude, { claudeFormat: true });
  expect(claude.thinking).toEqual({ type: "disabled" }); expect(claude.reasoning_effort).toBeUndefined();
  const ordinary = { model: "p/model", reasoning_effort: "high" };
  expect(m.applyNoThinkingAlias(ordinary).applied).toBe(false); expect(ordinary.reasoning_effort).toBe("high");
  const models = [{ id: "cc/claude-sonnet-4-6", name: "Sonnet", owned_by: "claude" }];
  expect(m.shouldExposeNoThinkingAlias(models[0])).toBe(true);
  const result = m.appendNoThinkingVariants(models, { cc: "claude" });
  expect(result[1]).toMatchObject({ id: "no-think/claude/claude-sonnet-4-6", root: "no-think/claude-sonnet-4-6", name: "Sonnet (no thinking)" });
  expect(models).toHaveLength(1);
  for (const model of [{ id: "cc/claude-sonnet-4-6-high" }, { ...models[0], owned_by: "combo" }, { id: "no-think/cc/claude-sonnet-4-6" }, { id: "unknown" }]) expect(m.shouldExposeNoThinkingAlias(model)).toBe(false);
  const empty: any[] = []; expect(m.appendNoThinkingVariants(empty)).toBe(empty);
});

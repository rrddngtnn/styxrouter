import { expect, test } from "bun:test";
import { getCodeBuddyCnUsage } from "../open-sse/services/usage/codebuddy-cn";
import { checkFallbackError } from "../open-sse/services/accountFallback";

test("bare CodeBuddy 6000 429 falls back as an ordinary rate limit", () => {
  const result = checkFallbackError(429, '{"code":6000}', 0, "synthetic", "codebuddy-cn");
  expect(result.shouldFallback).toBe(true);
  expect(result.reason).toBe("rate_limit_exceeded");
  expect(result.cooldownMs).toBeGreaterThan(0);
});

test("explicit zero usage and precise balance remain valid", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({code: 0, data: {Response: {Data: {Accounts: [{CycleStartTime: "2026-10-01T00:00:00Z", CycleEndTime: "2026-11-01T00:00:00Z", DeductionEndTime: "2027-01-01T00:00:00Z", CycleCapacitySize: 500, CycleCapacityUsedPrecise: "0"}]}}}}))) as typeof fetch;
  try { expect((await getCodeBuddyCnUsage("synthetic")).quotas?.Monthly).toMatchObject({used: 0, total: 500}); }
  finally { globalThis.fetch = original; }
});

test("missing usage is unknown, not a full CodeBuddy balance", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({code: 0, data: {Response: {Data: {Accounts: [{CycleStartTime: "2026-10-01T00:00:00Z", CycleEndTime: "2026-11-01T00:00:00Z", DeductionEndTime: "2027-01-01T00:00:00Z", CycleCapacitySize: 500}]}}}}))) as typeof fetch;
  try {
    const result = await getCodeBuddyCnUsage("synthetic");
    expect(result.quotas?.Monthly).toBeUndefined();
  } finally { globalThis.fetch = original; }
});

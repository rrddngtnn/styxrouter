import { expect, test } from "bun:test";
import pino from "pino";
import { redactLogArgs } from "../src/shared/utils/logRedaction.ts";
import { __setProviderDefaultRateLimitsForTests, acquireProviderDefaultSlot, awaitProviderDefaultSlot } from "../open-sse/services/providerDefaultRateLimit.ts";

test("Error subclass serialization cannot bypass the final logging safety hook", () => {
  class UnsafeError extends Error { toJSON() { return { password: "prototype-serialization-secret" }; } }
  const lines: string[] = [];
  const logger = pino({ hooks: { logMethod(args, method) { method.apply(this, redactLogArgs(args) as Parameters<typeof method>); } } }, { write(line) { lines.push(line); } });
  logger.info({ value: new UnsafeError("ordinary") });
  expect(lines.join("")).not.toContain("prototype-serialization-secret");
});

test("elapsed quota deadline cannot admit a slot after event-loop delay", async () => {
  __setProviderDefaultRateLimitsForTests({ test: { requests: 1, windowMs: 20 } });
  try {
    acquireProviderDefaultSlot("test", "late");
    const pending = awaitProviderDefaultSlot("test", "late", null, 1);
    const until = performance.now() + 40;
    while (performance.now() < until) { /* deterministic delayed timer delivery */ }
    await expect(pending).rejects.toHaveProperty("name", "TimeoutError");
    // A rejected waiter must not consume the now-free reservation.
    expect(acquireProviderDefaultSlot("test", "late")).toBe(0);
  } finally { __setProviderDefaultRateLimitsForTests(null); }
});

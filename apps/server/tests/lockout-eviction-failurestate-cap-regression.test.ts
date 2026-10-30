import { expect, test } from "bun:test";
import {
  evictLockoutOverflow,
  MODEL_LOCKOUT_EVICTION_CAP,
} from "../open-sse/services/accountFallback/lockoutEviction";
import type {
  ModelLockoutEntry,
  ModelFailureState,
} from "../open-sse/services/accountFallback";

function entry(untilOffsetMs: number): ModelLockoutEntry {
  const now = Date.now();
  return {
    reason: "rate_limit",
    until: now + untilOffsetMs,
    lockedAt: now,
    failureCount: 1,
    lastFailureAt: now,
    resetAfterMs: 0,
  };
}

function failure(): ModelFailureState {
  const now = Date.now();
  return { failureCount: 1, lastFailureAt: now, resetAfterMs: 0, lastCooldownMs: 0 };
}

// Contract (lockoutEviction.ts header): "Cap prevents unbounded growth under
// sustained load. Entries beyond this limit are evicted." The failureState
// sweep must bring the map back to the cap by evicting orphan entries (those
// with no corresponding active lockout). It must NOT stop early just because
// the oldest keys happen to be protected (have an active lockout): protected
// keys are not deletions, so they must not consume the overflow budget.
test("failureState eviction drops orphans down to cap even when oldest keys are protected", () => {
  const cap = 3;
  const modelLockouts = new Map<string, ModelLockoutEntry>();
  const modelFailureState = new Map<string, ModelFailureState>();

  // Two oldest keys are protected by an ACTIVE lockout (present in modelLockouts).
  // modelLockouts stays at/under cap so the first eviction block is a no-op.
  modelLockouts.set("p:c:k1", entry(60_000));
  modelLockouts.set("p:c:k2", entry(60_000));

  // Five failureState entries, insertion order k1..k5. k1,k2 protected; k3,k4,k5
  // are orphans (no lockout) and are the legitimate eviction candidates.
  for (const k of ["p:c:k1", "p:c:k2", "p:c:k3", "p:c:k4", "p:c:k5"]) {
    modelFailureState.set(k, failure());
  }

  expect(modelFailureState.size).toBe(5);

  evictLockoutOverflow(modelLockouts, modelFailureState, cap);

  // Overflow is 2 (5 - 3). There are 3 orphans available to evict, so the map
  // must come back down to the cap. The bug leaves it at 5 because the two
  // protected skips wrongly consumed the whole overflow budget before any
  // orphan was reached.
  expect(modelFailureState.size).toBe(cap);
  // Protected (active-lockout) keys must survive.
  expect(modelFailureState.has("p:c:k1")).toBe(true);
  expect(modelFailureState.has("p:c:k2")).toBe(true);
});

test("eviction cap export is a positive bound", () => {
  expect(MODEL_LOCKOUT_EVICTION_CAP).toBeGreaterThan(0);
});

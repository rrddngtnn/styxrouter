import { expect, test } from "bun:test";
import { getDbInstance } from "../src/lib/db/core";
import { getProviderLimitsCache, setProviderLimitsCache, updateProviderLimitsCache } from "../src/lib/db/providerLimits";

const seed = { quotas: {}, plan: null, message: "original", fetchedAt: "2025-01-01T00:00:00.000Z" };

test("async updates are rejected before invocation, including delayed work", async () => {
  const id = "async-update";
  setProviderLimitsCache(id, seed);
  let invoked = false;
  const update = async () => { invoked = true; await Bun.sleep(10); setProviderLimitsCache(id, { ...seed, message: "late" }); return seed; };
  expect(() => updateProviderLimitsCache(id, update as never)).toThrow(/synchronous/i);
  await Bun.sleep(30);
  expect(invoked).toBe(false);
  expect(getProviderLimitsCache(id)?.message).toBe("original");
});

test("thenable returns throw and rollback synchronous callback writes", async () => {
  const id = "thenable-update";
  setProviderLimitsCache(id, seed);
  const update = () => {
    setProviderLimitsCache(id, { ...seed, message: "uncommitted" });
    return Promise.resolve(seed);
  };
  expect(() => updateProviderLimitsCache(id, update as never)).toThrow(/synchronous/i);
  await Promise.resolve();
  expect(getProviderLimitsCache(id)?.message).toBe("original");
});

test("synchronous updates retain normal return, persistence and rollback", () => {
  const id = "sync-update";
  setProviderLimitsCache(id, seed);
  const result = updateProviderLimitsCache(id, (previous, revision) => {
    expect(previous?.message).toBe("original");
    expect(revision).toBeGreaterThan(0);
    return { ...previous!, message: "updated" };
  });
  expect(result?.message).toBe("updated");
  expect(getProviderLimitsCache(id)?.message).toBe("updated");
  expect(() => updateProviderLimitsCache(id, () => { setProviderLimitsCache(id, seed); throw new Error("rollback"); })).toThrow("rollback");
  expect(getProviderLimitsCache(id)?.message).toBe("updated");
  expect(getDbInstance()).toBeDefined();
});

import { afterAll, describe, expect, test } from "bun:test";
import { getAggregatedSnapshots, saveQuotaSnapshot } from "../src/lib/db/quotaSnapshots";
import { closeDbInstance, getDbInstance } from "../src/lib/db/core";

afterAll(() => closeDbInstance({ checkpointMode: null }));

describe("getAggregatedSnapshots window_key mapping", () => {
  test("aggregated points surface the window_key column value", () => {
    getDbInstance();
    saveQuotaSnapshot({
      provider: "fixture-prov",
      connection_id: "conn-1",
      window_key: "5h",
      remaining_percentage: 42,
      is_exhausted: 0,
      next_reset_at: "2026-01-01T00:00:00.000Z",
      window_duration_ms: 18000000,
      raw_data: "{}",
    });

    const points = getAggregatedSnapshots({
      since: "2000-01-01T00:00:00.000Z",
      bucketMinutes: 60,
      aggregateBy: "provider",
    });

    const point = points.find((p) => p.provider === "fixture-prov");
    expect(point).toBeDefined();
    expect(point!.windowKey).toBe("5h");
  });
});

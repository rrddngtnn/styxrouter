import { afterAll, describe, expect, test } from "bun:test";
import { buildUnifiedSource, getProviderDailyUsageRows } from "../src/lib/db/usageAnalytics";
import { closeDbInstance, getDbInstance } from "../src/lib/db/core";

afterAll(() => closeDbInstance({ checkpointMode: null }));

describe("usage analytics across raw and rolled-up storage", () => {
  test("provider daily request totals sum rolled-up request counts", () => {
    const db = getDbInstance();
    db.prepare("INSERT INTO usage_history (provider, model, tokens_input, tokens_output, timestamp) VALUES (?, ?, ?, ?, ?)")
      .run("openai", "gpt-test", 1, 1, "2026-01-02T12:00:00.000Z");
    db.prepare("INSERT INTO daily_usage_summary (date, provider, model, total_requests, total_input_tokens, total_output_tokens) VALUES (?, ?, ?, ?, ?, ?)")
      .run("2025-12-01", "openai", "gpt-test", 7, 7, 7);
    const { unifiedSource, unifiedParams } = buildUnifiedSource({
      sinceIso: null,
      untilIso: null,
      rawCutoffDate: "2026-01-01",
      apiKeyWhere: "",
      apiKeyParams: {},
    });
    expect(getProviderDailyUsageRows(unifiedSource, unifiedParams)).toEqual([
      expect.objectContaining({ date: "2026-01-02", requests: 1 }),
      expect.objectContaining({ date: "2025-12-01", requests: 7 }),
    ]);
  });
});

import { expect, test } from "bun:test";
import { getDbInstance } from "../src/lib/db/core";
import { buildComboForecastResponse } from "../src/lib/usage/comboForecast";

test("forecast excludes call logs after its as-of time", async () => {
  const db = getDbInstance();
  const insert = db.prepare("INSERT INTO call_logs (id, timestamp, status, detail_state, combo_name, provider, model, tokens_in, tokens_out) VALUES (?, ?, 200, 'none', 'forecast-fixture', 'fixture', 'model', 10, 5)");
  insert.run("forecast-before", "2026-01-02T11:00:00.000Z");
  insert.run("forecast-after", "2026-01-02T13:00:00.000Z");
  const result = await buildComboForecastResponse({
    range: "24h", horizon: "24h", now: Date.parse("2026-01-02T12:00:00.000Z"),
    combos: [{ id: "forecast-id", name: "forecast-fixture", models: [] }] as any,
  });
  expect(result.combos[0].history.requests).toBe(1);
  expect(result.combos[0].history.totalTokens).toBe(15);
  expect(result.combos[0].forecast.projectedRequests).toBe(1);
});

test("forecast excludes quota snapshots after its as-of time", async () => {
  const db = getDbInstance();
  const insert = db.prepare("INSERT INTO quota_snapshots (provider, connection_id, window_key, remaining_percentage, is_exhausted, created_at) VALUES (?, ?, ?, ?, 0, ?)");
  insert.run("openai", "fixture-account", "daily", 80, "2026-01-02T11:00:00.000Z");
  insert.run("openai", "fixture-account", "daily", 10, "2026-01-02T13:00:00.000Z");
  const result = await buildComboForecastResponse({
    range: "24h", horizon: "24h", now: Date.parse("2026-01-02T12:00:00.000Z"),
    combos: [{ id: "quota-id", name: "quota-fixture", models: [{ kind: "model", model: "openai/test", providerId: "openai", connectionId: "fixture-account", weight: 100 }] }] as any,
  });
  expect(result.combos[0].targets.length).toBe(1);
  expect(result.combos[0].targets[0].quota.remainingPct).toBe(80);
});

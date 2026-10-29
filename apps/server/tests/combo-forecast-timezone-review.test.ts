import { expect, test } from "bun:test";
import { getDbInstance } from "../src/lib/db/core";
import { buildComboForecastResponse } from "../src/lib/usage/comboForecast";

test("forecast compares timestamp offsets by instant, including millisecond boundaries", async () => {
  const db = getDbInstance();
  const log = db.prepare("INSERT INTO call_logs (id, timestamp, status, detail_state, combo_name, provider, model, tokens_in, tokens_out) VALUES (?, ?, 200, 'none', 'tz-forecast', 'tz-provider', 'model', 1, 0)");
  log.run("tz-before", "2026-01-02T13:59:59.999+02:00");
  log.run("tz-future", "2026-01-02T06:00:00.001-06:00");
  const snapshot = db.prepare("INSERT INTO quota_snapshots (provider, connection_id, window_key, remaining_percentage, is_exhausted, created_at) VALUES ('tz-provider', 'tz-account', 'daily', ?, 0, ?)");
  snapshot.run(80, "2026-01-02T13:59:59.999+02:00");
  snapshot.run(10, "2026-01-02T06:00:00.001-06:00");
  const result = await buildComboForecastResponse({
    range: "24h", horizon: "24h", now: Date.parse("2026-01-02T12:00:00.000Z"),
    combos: [{ id: "tz-id", name: "tz-forecast", models: [{ kind: "model", model: "tz-provider/test", providerId: "tz-provider", connectionId: "tz-account", weight: 100 }] }] as any,
  });
  expect(result.combos[0].history.requests).toBe(1);
  expect(result.combos[0].targets[0].quota.remainingPct).toBe(80);
});

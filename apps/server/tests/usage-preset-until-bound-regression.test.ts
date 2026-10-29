import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { buildPresetUnifiedSource } from '../src/lib/db/usageAnalytics/sources';

test('preset analytics honors its upper bound for both raw and rolled-up usage', () => {
  const db = new Database(':memory:');
  try {
    db.run(`CREATE TABLE usage_history (timestamp TEXT, provider TEXT, model TEXT, service_tier TEXT, tokens_input INTEGER, tokens_output INTEGER, tokens_cache_read INTEGER, tokens_cache_creation INTEGER, tokens_reasoning INTEGER)`);
    db.run(`CREATE TABLE daily_usage_summary (date TEXT, provider TEXT, model TEXT, total_input_tokens INTEGER, total_output_tokens INTEGER)`);
    db.run(`INSERT INTO usage_history VALUES ('2026-03-05T10:00:00.000Z','p','m','standard',1,0,0,0,0), ('2026-03-07T10:00:00.000Z','p','m','standard',10,0,0,0,0)`);
    db.run(`INSERT INTO daily_usage_summary VALUES ('2026-02-01','p','m',100,0), ('2026-02-09','p','m',1000,0)`);
    const run = (untilIso: string) => {
      const { unifiedSource, unifiedParams } = buildPresetUnifiedSource({ sinceIso: null, untilIso, rawCutoffDate: '2026-03-01', apiKeyWhere: '', apiKeyParams: {} });
      const params = Object.fromEntries(Object.entries(unifiedParams).map(([key, value]) => [`@${key}`, value]));
      return db.query(`SELECT COALESCE(SUM(tokens_input), 0) AS tokens FROM ${unifiedSource}`).get(params) as { tokens: number };
    };
    expect(run('2026-02-05T23:59:59.999Z').tokens).toBe(100);
    expect(run('2026-03-06T23:59:59.999Z').tokens).toBe(1101);
  } finally { db.close(); }
});

import { test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { buildUnifiedSource } from '../src/lib/db/usageAnalytics/sources';

test('provider scope filters raw and historical aggregates without SQL interpolation', () => {
  const db = new Database(':memory:', { strict: true });
  db.run(`CREATE TABLE usage_history(timestamp TEXT, provider TEXT, model TEXT, tokens_input INT, tokens_output INT, tokens_cache_read INT, tokens_cache_creation INT, tokens_reasoning INT, service_tier TEXT, success INT, latency_ms INT, connection_id TEXT, account_key TEXT, api_key_id TEXT, api_key_name TEXT)`);
  db.run(`CREATE TABLE daily_usage_summary(date TEXT, provider TEXT, model TEXT, total_input_tokens INT, total_output_tokens INT, total_requests INT)`);
  db.run(`INSERT INTO usage_history(timestamp,provider,model,tokens_input,tokens_output,success) VALUES ('2026-01-20','alpha','m',2,3,1),('2026-01-20','beta','m',8,9,1)`);
  db.run(`INSERT INTO daily_usage_summary VALUES ('2026-01-01','alpha','m',10,20,4),('2026-01-01','beta','m',100,200,9)`);
  const { unifiedSource, unifiedParams } = buildUnifiedSource({ sinceIso: null, untilIso: null, rawCutoffDate: '2026-01-10', apiKeyWhere: '', apiKeyParams: {}, provider: 'alpha' });
  const row = db.query(`SELECT SUM(requests) requests, SUM(tokens_input + tokens_output) tokens FROM ${unifiedSource}`).get(unifiedParams);
  expect(row).toEqual({ requests: 5, tokens: 35 });
  db.close();
});

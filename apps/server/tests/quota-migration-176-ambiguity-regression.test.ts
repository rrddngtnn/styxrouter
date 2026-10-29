import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";

test("migration 176 preserves ambiguous legacy pools as unknown rather than guessing", () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE quota_pools(id TEXT PRIMARY KEY); CREATE TABLE api_keys(id TEXT PRIMARY KEY, allowed_quotas TEXT); CREATE TABLE quota_allocations(pool_id TEXT, api_key_id TEXT);");
  db.exec(`INSERT INTO quota_pools VALUES ('manual'), ('empty'), ('mixed'); INSERT INTO api_keys VALUES ('a','["manual","mixed"]'), ('b','[]'); INSERT INTO quota_allocations VALUES ('manual','a'), ('mixed','a'), ('mixed','b');`);
  db.exec(readFileSync(new URL("../src/lib/db/migrations/176_quota_pool_exclusive.sql", import.meta.url), "utf8"));
  expect(db.query("SELECT id, exclusive FROM quota_pools ORDER BY id").all()).toEqual([{ id: "empty", exclusive: null }, { id: "manual", exclusive: null }, { id: "mixed", exclusive: null }]);
  expect(db.query("SELECT allowed_quotas FROM api_keys WHERE id='a'").get()).toEqual({allowed_quotas:'["manual","mixed"]'});
  db.close();
});

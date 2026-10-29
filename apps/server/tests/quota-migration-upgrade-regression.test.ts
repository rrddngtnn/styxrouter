import { afterAll, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBunSqliteAdapter } from "../src/lib/db/adapters/bunSqliteAdapter";

// Freeze this fixture at 179, independently of migrations being developed later.
const migrationDir = new URL("../src/lib/db/migrations/", import.meta.url);
const isolatedMigrations = mkdtempSync(join(tmpdir(), "styx-migration-179-"));
for (const filename of readdirSync(migrationDir)) {
  const match = /^(\d+)_.*\.sql$/.exec(filename);
  if (match && Number(match[1]) <= 179) copyFileSync(new URL(filename, migrationDir), join(isolatedMigrations, filename));
}
process.env.STYX_MIGRATIONS_DIR = isolatedMigrations;
process.env.STYX_EXTRA_MIGRATIONS_DIRS = "";
const { runMigrations } = await import("../src/lib/db/migrationRunner");
afterAll(() => rmSync(isolatedMigrations, { recursive: true, force: true }));

const migrationFiles = readdirSync(isolatedMigrations)
  .sort()
  .map((filename) => /^(\d+)_(.+)\.sql$/.exec(filename))
  .filter((match): match is RegExpExecArray => match !== null)
  .map((match) => ({ version: match[1], name: match[2] }));
const pendingNames = new Set(["quota_pool_exclusive", "quota_reserved_pool_id", "quota_combo_generation", "catalog_permission_revision"]);
const historicalTail = [
  ["163", "model_capabilities"], ["164", "retire_microsoft_designer_web"],
  ["165", "retire_felo_web"], ["166", "retire_gpl_derived_providers"],
  ["167", "retire_qwen_web"], ["168", "retire_chatgpt_web"],
  ["169", "model_capabilities"], ["170", "log_export_destinations"],
  ["171", "restore_chatgpt_web_cleanroom"], ["172", "provider_node_daily_quota_reset"],
  ["173", "call_logs_video_content_removed"], ["174", "server_tool_executions"],
  ["175", "call_logs_provider_stats_indexes"],
];

function legacyDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE _styx_migrations(version TEXT PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT DEFAULT 'historic');
    CREATE TABLE db_meta(key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE provider_connections(id TEXT PRIMARY KEY, provider TEXT);
    CREATE TABLE quota_groups(id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE quota_pools(id TEXT PRIMARY KEY, connection_id TEXT, group_id TEXT, name TEXT);
    CREATE TABLE quota_pool_connections(pool_id TEXT, connection_id TEXT);
    CREATE TABLE api_keys(id TEXT PRIMARY KEY, key TEXT, key_hash TEXT, model_access_mode TEXT,
      allowed_models TEXT, blocked_models TEXT, allowed_combos TEXT, allowed_connections TEXT,
      allowed_quotas TEXT, disable_non_public_models INTEGER, is_active INTEGER, is_banned INTEGER,
      revoked_at TEXT, expires_at TEXT, scopes TEXT, allowed_endpoints TEXT, last_used_at TEXT);
    CREATE TABLE key_groups(id TEXT PRIMARY KEY, is_active INTEGER);
    CREATE TABLE group_model_permissions(id TEXT PRIMARY KEY, group_id TEXT, model_pattern TEXT, provider TEXT, access_type TEXT);
    CREATE TABLE key_group_members(key_id TEXT, group_id TEXT);
    CREATE TABLE quota_allocations(pool_id TEXT, api_key_id TEXT);
    INSERT INTO provider_connections VALUES ('c', 'openai');
    INSERT INTO quota_groups VALUES ('g', 'legacy group');
    INSERT INTO quota_pools VALUES ('manual', 'c', 'g', 'manual'), ('empty', 'c', 'g', 'empty'),
      ('__quota_access_revoked__', 'c', 'g', 'legacy collision');
    INSERT INTO quota_pool_connections VALUES ('manual', 'c');
    INSERT INTO api_keys(id, allowed_quotas) VALUES ('a', '["manual"]');
    INSERT INTO quota_allocations VALUES ('manual', 'a');
  `);
  const insert = db.query("INSERT OR IGNORE INTO _styx_migrations(version, name) VALUES (?, ?)");
  for (const migration of migrationFiles.filter((file) => Number(file.version) <= 175)) {
    insert.run(migration.version, migration.name);
  }
  for (const [version, name] of historicalTail) {
    // This deliberately models version-only tracking from an existing deployment.
    insert.run(version, name);
  }
  return db;
}

function ledger(db: Database) {
  return db.query("SELECT version, name, applied_at FROM _styx_migrations ORDER BY version").all();
}

test("upgrade preserves previously explicit exclusivity and repairs missing quota guards", () => {
  const db = legacyDb();
  try {
    // A checkout may have run the unpublished quota column migration under 163,
    // or an operator may have added the column before the ledger was repaired.
    db.exec(`ALTER TABLE quota_pools ADD COLUMN exclusive INTEGER DEFAULT NULL;
      UPDATE quota_pools SET exclusive=1 WHERE id='manual';
      UPDATE quota_pools SET exclusive=0 WHERE id='empty';
      UPDATE _styx_migrations SET name='quota_pool_exclusive' WHERE version='163';
      INSERT INTO db_meta VALUES ('quota_combo_generation', '42');`);
    const before = ledger(db).filter((row: any) => Number(row.version) <= 175);
    const adapter = createBunSqliteAdapter(db, ":memory:");
    expect(runMigrations(adapter)).toBe(4);
    expect(ledger(db).filter((row: any) => Number(row.version) <= 175)).toEqual(before);
    expect(db.query("SELECT id, exclusive FROM quota_pools ORDER BY id").all()).toEqual([
      { id: "__quota_access_revoked__", exclusive: null },
      { id: "empty", exclusive: 0 }, { id: "manual", exclusive: 1 },
    ]);
    expect(generation(db)).toBe(42);
    expect(() => db.exec("UPDATE quota_pools SET id='__quota_access_revoked__' WHERE id='empty'")).toThrow("reserved quota pool id");
    expect(db.query("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'quota_combo_generation_%'").all()).toHaveLength(12);
    expect(runMigrations(adapter)).toBe(0);
  } finally { db.close(); }
});

function generation(db: Database) {
  return Number((db.query("SELECT value FROM db_meta WHERE key='quota_combo_generation'").get() as { value: string }).value);
}

test("quota migrations use additive slots beyond the occupied historical ledger", () => {
  expect(migrationFiles.filter((file) => pendingNames.has(file.name))).toEqual([
    { version: "176", name: "quota_pool_exclusive" },
    { version: "177", name: "quota_reserved_pool_id" },
    { version: "178", name: "quota_combo_generation" },
    { version: "179", name: "catalog_permission_revision" },
  ]);
});

test("existing deployment upgrades quota schema without rewriting history or permissions", () => {
  const db = legacyDb();
  try {
    const before = ledger(db).filter((row: any) => Number(row.version) <= 175);
    const adapter = createBunSqliteAdapter(db, ":memory:");
    expect(runMigrations(adapter)).toBe(4);
    expect(ledger(db).filter((row: any) => Number(row.version) <= 175)).toEqual(before);
    expect(ledger(db).filter((row: any) => Number(row.version) >= 176).map(({ version, name }: any) => ({ version, name })))
      .toEqual(migrationFiles.filter((file) => pendingNames.has(file.name)));
    const revision = () => Number((db.query("SELECT value FROM db_meta WHERE key='catalog_permission_revision'").get() as { value: string }).value);
    expect(revision()).toBe(1);
    expect(db.query("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'catalog_permission_revision_%'").all()).toHaveLength(12);
    db.exec("UPDATE api_keys SET last_used_at='later' WHERE id='a'");
    expect(revision()).toBe(1);
    db.exec("UPDATE api_keys SET allowed_quotas='[]' WHERE id='a'");
    expect(revision()).toBe(2);
    db.exec("UPDATE api_keys SET allowed_quotas='[\"manual\"]' WHERE id='a'");
    expect(revision()).toBe(3);
    expect(db.query("SELECT id, exclusive FROM quota_pools ORDER BY id").all()).toEqual([
      { id: "__quota_access_revoked__", exclusive: null },
      { id: "empty", exclusive: null }, { id: "manual", exclusive: null },
    ]);
    expect(db.query("SELECT id, allowed_quotas FROM api_keys").all()).toEqual([{ id: "a", allowed_quotas: '["manual"]' }]);
    expect(db.query("SELECT * FROM quota_allocations").all()).toEqual([{ pool_id: "manual", api_key_id: "a" }]);
    expect(() => db.exec("INSERT OR REPLACE INTO quota_pools(id) VALUES ('__quota_access_revoked__')")).toThrow("reserved quota pool id");
    expect(() => db.exec("UPDATE quota_pools SET id='__quota_access_revoked__' WHERE id='empty'")).toThrow("reserved quota pool id");
    const current = generation(db);
    db.exec("UPDATE quota_groups SET name='renamed' WHERE id='g'");
    expect(generation(db)).toBe(current + 1);
    // Changing the group identity also changes which pools resolve its name.
    db.exec("UPDATE quota_groups SET id='changed' WHERE id='g'");
    expect(generation(db)).toBe(current + 2);
    const upgradedLedger = ledger(db);
    expect(runMigrations(adapter)).toBe(0);
    expect(ledger(db)).toEqual(upgradedLedger);
    expect(generation(db)).toBe(current + 2);
  } finally { db.close(); }
});

import { expect, test } from "bun:test";
import { readFileSync, mkdtempSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { createBunSqliteAdapter } from "../src/lib/db/adapters/bunSqliteAdapter";
import { getDbInstance } from "../src/lib/db/core";
import { getCatalogContextRevision } from "../src/lib/db/catalogContextRevision";

test("context revision is transactional and additive migration is idempotent", () => {
  const db = getDbInstance();
  const initial = getCatalogContextRevision();
  expect(() => db.immediate(() => {
    db.prepare("INSERT INTO model_context_overrides(provider,model_id,real_context,source,refreshed_at) VALUES ('codex','revision-fixture',123,'manual',datetime('now'))").run();
    expect(getCatalogContextRevision()).toBe(initial + 1);
    throw new Error("rollback");
  })).toThrow("rollback");
  expect(getCatalogContextRevision()).toBe(initial);
  db.prepare("INSERT INTO model_context_overrides(provider,model_id,real_context,source,refreshed_at) VALUES ('codex','revision-fixture',123,'manual',datetime('now'))").run();
  expect(getCatalogContextRevision()).toBe(initial + 1);
  db.exec(readFileSync(new URL('../src/lib/db/migrations/182_catalog_context_revision.sql', import.meta.url), 'utf8'));
  expect(getCatalogContextRevision()).toBe(initial + 1);
});

test("historical ledger upgrade applies 182 once without changing existing rows", async () => {
  const dir = mkdtempSync(join(tmpdir(), "context-migration-"));
  copyFileSync(new URL('../src/lib/db/migrations/182_catalog_context_revision.sql', import.meta.url), join(dir, '182_catalog_context_revision.sql'));
  const previous = process.env.STYX_MIGRATIONS_DIR;
  process.env.STYX_MIGRATIONS_DIR = dir;
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE _styx_migrations(version TEXT PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT DEFAULT 'historical');
      INSERT INTO _styx_migrations(version,name) VALUES ('178','quota_combo_generation'),('179','catalog_permission_revision'),('181','quota_combo_group_id_generation');
      CREATE TABLE db_meta(key TEXT PRIMARY KEY,value TEXT);
      CREATE TABLE provider_connections(id TEXT PRIMARY KEY,provider TEXT,is_active INTEGER);
      CREATE TABLE key_value(namespace TEXT,key TEXT,value TEXT);
      CREATE TABLE model_context_overrides(provider TEXT,model_id TEXT,real_context INTEGER,source TEXT,refreshed_at TEXT);
      INSERT INTO model_context_overrides VALUES ('codex','fixture',123,'manual','old');`);
    const { runMigrations } = await import(`../src/lib/db/migrationRunner.ts?context-revision-fixture`);
    const adapter = createBunSqliteAdapter(db, ':memory:');
    expect(runMigrations(adapter)).toBe(1);
    expect(db.query("SELECT version,name FROM _styx_migrations ORDER BY version").all()).toEqual([
      {version:'178',name:'quota_combo_generation'}, {version:'179',name:'catalog_permission_revision'},
      {version:'181',name:'quota_combo_group_id_generation'}, {version:'182',name:'catalog_context_revision'}]);
    expect(db.query("SELECT real_context,source FROM model_context_overrides").get()).toEqual({real_context:123,source:'manual'});
    expect(runMigrations(adapter)).toBe(0);
  } finally {
    db.close(); rmSync(dir,{recursive:true,force:true});
    if (previous === undefined) delete process.env.STYX_MIGRATIONS_DIR; else process.env.STYX_MIGRATIONS_DIR = previous;
  }
});

import { afterAll, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBunSqliteAdapter } from "../src/lib/db/adapters/bunSqliteAdapter";

const dir = mkdtempSync(join(tmpdir(), "styx-migration-181-"));
process.env.STYX_MIGRATIONS_DIR = dir;
process.env.STYX_EXTRA_MIGRATIONS_DIRS = "";
const { runMigrations } = await import("../src/lib/db/migrationRunner");
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("previously applied 178 gets the group-id fence without resetting state", () => {
  const repair = new URL("../src/lib/db/migrations/181_quota_combo_group_id_generation.sql", import.meta.url);
  expect(existsSync(repair)).toBe(true);
  copyFileSync(repair, join(dir, "181_quota_combo_group_id_generation.sql"));
  const db = new Database(":memory:");
  try {
    db.exec(`CREATE TABLE _styx_migrations(version TEXT PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT DEFAULT 'historic');
      INSERT INTO _styx_migrations(version,name) VALUES ('178','quota_combo_generation'), ('179','catalog_permission_revision');
      CREATE TABLE db_meta(key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE quota_groups(id TEXT PRIMARY KEY, name TEXT);
      INSERT INTO db_meta VALUES ('quota_combo_generation','42');
      INSERT INTO quota_groups VALUES ('g','group');`);
    // Simulate exactly the originally applied 178, without editing the checkout.
    const old178 = readFileSync(new URL("../src/lib/db/migrations/178_quota_combo_generation.sql", import.meta.url), "utf8");
    const trigger = old178.match(/CREATE TRIGGER IF NOT EXISTS quota_combo_generation_group_update[\s\S]*?END;/)![0]
      .replace("AFTER UPDATE OF id, name", "AFTER UPDATE OF name");
    db.exec(trigger);
    const adapter = createBunSqliteAdapter(db, ":memory:");
    expect(runMigrations(adapter)).toBe(1);
    expect(db.query("SELECT value FROM db_meta WHERE key='quota_combo_generation'").get()).toEqual({ value: "43" });
    db.exec("UPDATE quota_groups SET id='h' WHERE id='g'");
    expect(db.query("SELECT value FROM db_meta WHERE key='quota_combo_generation'").get()).toEqual({ value: "44" });
    db.exec("UPDATE quota_groups SET name='new' WHERE id='h'");
    expect(db.query("SELECT value FROM db_meta WHERE key='quota_combo_generation'").get()).toEqual({ value: "45" });
    expect(runMigrations(adapter)).toBe(0);
    expect(db.query("SELECT version, name, applied_at FROM _styx_migrations WHERE version IN ('178','179') ORDER BY version").all()).toEqual([
      { version: "178", name: "quota_combo_generation", applied_at: "historic" },
      { version: "179", name: "catalog_permission_revision", applied_at: "historic" },
    ]);
  } finally { db.close(); }
});

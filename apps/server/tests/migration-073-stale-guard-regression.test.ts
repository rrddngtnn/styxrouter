import { afterAll, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Regression for the stale `case "073"` idempotency guard in migrationRunner.
// Disk 073 is `per_model_token_limits`, but the guard checked `memories.needs_reindex`
// — a column owned by the memory_vec migration (disk 083). On any DB where
// needs_reindex already exists (083 applied, or gap-reconciliation back-filling
// 073 after 083), the guard made the runner SILENTLY skip 073 and mark it applied,
// leaving `api_key_token_limits` and its sibling tables/index missing with no error.

const migrationDir = new URL("../src/lib/db/migrations/", import.meta.url);
const isolated = mkdtempSync(join(tmpdir(), "styx-mig-073-"));
copyFileSync(new URL("073_per_model_token_limits.sql", migrationDir), join(isolated, "073_per_model_token_limits.sql"));
process.env.STYX_MIGRATIONS_DIR = isolated;
process.env.STYX_EXTRA_MIGRATIONS_DIRS = "";
process.env.DISABLE_SQLITE_AUTO_BACKUP = "true";
const { runMigrations } = await import("../src/lib/db/migrationRunner");
const { createBunSqliteAdapter } = await import("../src/lib/db/adapters/bunSqliteAdapter");
afterAll(() => rmSync(isolated, { recursive: true, force: true }));

function hasTable(db: Database, name: string): boolean {
  return db.query("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name) != null;
}

function seed(db: Database) {
  // Base tables 073 touches, plus `memories.needs_reindex` already present —
  // the exact column the stale guard keyed on. 073 itself is NOT yet applied.
  db.exec(`
    CREATE TABLE _styx_migrations(version TEXT PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT DEFAULT 'h');
    CREATE TABLE memories(id TEXT PRIMARY KEY, needs_reindex INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE usage_history(id TEXT PRIMARY KEY, api_key_id TEXT, provider TEXT, model TEXT, timestamp TEXT);
  `);
}

test("073 (per_model_token_limits) applies even when memories.needs_reindex already exists", () => {
  const db = new Database(":memory:");
  try {
    seed(db);
    const adapter = createBunSqliteAdapter(db, ":memory:");

    // 073 is pending; needs_reindex (memory_vec/083's column) is already present.
    const applied = runMigrations(adapter);

    expect(applied).toBe(1);
    // The real target of disk 073 — must exist, not be silently skipped.
    expect(hasTable(db, "api_key_token_limits")).toBe(true);
    expect(hasTable(db, "api_key_token_counters")).toBe(true);
    expect(hasTable(db, "api_key_token_limit_reset_logs")).toBe(true);
    expect(
      db.query("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_uh_key_provider_model_ts'").get()
    ).not.toBeNull();
    expect(
      db.query("SELECT version, name FROM _styx_migrations WHERE version='073'").get()
    ).toEqual({ version: "073", name: "per_model_token_limits" });
  } finally {
    db.close();
  }
});

test("073 is idempotent: re-running when its tables already exist is a clean no-op", () => {
  const db = new Database(":memory:");
  try {
    seed(db);
    const adapter = createBunSqliteAdapter(db, ":memory:");
    expect(runMigrations(adapter)).toBe(1);
    // Second run: already applied, nothing pending, no throw, tables intact.
    expect(runMigrations(adapter)).toBe(0);
    expect(hasTable(db, "api_key_token_limits")).toBe(true);
  } finally {
    db.close();
  }
});

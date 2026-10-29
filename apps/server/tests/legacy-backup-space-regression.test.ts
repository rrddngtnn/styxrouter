import { expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DB_BACKUPS_DIR, getDbInstance } from "../src/lib/db/core";
import { backupDbFile } from "../src/lib/db/backup";

test("automatic legacy backup refuses low space without consuming its throttle, then succeeds", async () => {
  const db = getDbInstance();
  db.exec("CREATE TABLE IF NOT EXISTS backup_space_fixture (value TEXT); INSERT INTO backup_space_fixture VALUES ('saved')");
  db.prepare("INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES (?, ?, ?)").run("databaseSettings", "autoBackupEnabled", "true");
  const before = existsSync(DB_BACKUPS_DIR!) ? readdirSync(DB_BACKUPS_DIR!) : [];
  const argv = process.argv.slice();
  const execArgv = process.execArgv.slice();
  const nodeEnv = process.env.NODE_ENV;
  const vitest = process.env.VITEST;
  const disabled = process.env.DISABLE_SQLITE_AUTO_BACKUP;
  const headroom = process.env.STYX_BACKUP_MIN_FREE_MB;
  try {
    process.argv.splice(0, process.argv.length, "bun", "server.js");
    process.execArgv.splice(0);
    process.env.NODE_ENV = "production";
    delete process.env.VITEST;
    delete process.env.DISABLE_SQLITE_AUTO_BACKUP;
    process.env.STYX_BACKUP_MIN_FREE_MB = "1000000000000";
    expect(backupDbFile("auto")).toBeNull();
    expect(existsSync(DB_BACKUPS_DIR!) ? readdirSync(DB_BACKUPS_DIR!) : []).toEqual(before);
    process.env.STYX_BACKUP_MIN_FREE_MB = "0";
    const result = backupDbFile("auto");
    expect(result).not.toBeNull();
    const file = join(DB_BACKUPS_DIR!, result!.filename);
    for (let i = 0; i < 100 && !existsSync(file); i++) await new Promise(r => setTimeout(r, 10));
    expect(existsSync(file)).toBe(true);
    const { Database } = await import("bun:sqlite");
    const snapshot = new Database(file, { readonly: true });
    try { expect(snapshot.query("SELECT value FROM backup_space_fixture").get()).toEqual({ value: "saved" }); }
    finally { snapshot.close(); }
  } finally {
    process.argv.splice(0, process.argv.length, ...argv);
    process.execArgv.splice(0, process.execArgv.length, ...execArgv);
    for (const [key, value] of Object.entries({ NODE_ENV: nodeEnv, VITEST: vitest, DISABLE_SQLITE_AUTO_BACKUP: disabled, STYX_BACKUP_MIN_FREE_MB: headroom })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

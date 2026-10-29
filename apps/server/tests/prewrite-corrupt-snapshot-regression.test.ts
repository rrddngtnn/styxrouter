import { expect, test, mock } from "bun:test";
import { readdirSync, writeFileSync } from "node:fs";

mock.module("@/shared/utils/testProcess", () => ({ isAutomatedTestProcess: () => false }));
const { DB_BACKUPS_DIR, getDbInstance } = await import("../src/lib/db/core");
const { backupBeforeDestructiveWrite } = await import("../src/lib/db/preWriteBackup");

test("pre-write backup never publishes a corrupt completed snapshot", async () => {
  const db = getDbInstance();
  db.prepare("INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES (?, ?, ?)").run("databaseSettings", "autoBackupEnabled", "true");
  const original = db.backup;
  const old = process.env.STYX_BACKUP_MIN_FREE_MB;
  process.env.STYX_BACKUP_MIN_FREE_MB = "0";
  db.backup = async destination => { writeFileSync(destination, "not sqlite"); };
  try {
    await backupBeforeDestructiveWrite();
    expect(readdirSync(DB_BACKUPS_DIR!).filter(name => name.endsWith("_pre-write.sqlite") || name.startsWith(".backup-"))).toEqual([]);
  } finally {
    db.backup = original;
    if (old === undefined) delete process.env.STYX_BACKUP_MIN_FREE_MB; else process.env.STYX_BACKUP_MIN_FREE_MB = old;
  }
});

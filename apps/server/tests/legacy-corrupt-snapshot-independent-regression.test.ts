import { expect, test } from "bun:test";
import { readdirSync, writeFileSync } from "node:fs";
import { DB_BACKUPS_DIR, getDbInstance } from "../src/lib/db/core";
import { backupDbFile } from "../src/lib/db/backup";

test("legacy backup refuses a successfully completed corrupt snapshot", async () => {
  const db = getDbInstance();
  const original = db.backup;
  const old = process.env.STYX_BACKUP_MIN_FREE_MB;
  process.env.STYX_BACKUP_MIN_FREE_MB = "0";
  db.backup = async destination => { writeFileSync(destination, "not sqlite"); };
  try {
    backupDbFile("manual");
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(readdirSync(DB_BACKUPS_DIR!).filter(name => name.endsWith("_manual.sqlite"))).toEqual([]);
  } finally {
    db.backup = original;
    if (old === undefined) delete process.env.STYX_BACKUP_MIN_FREE_MB; else process.env.STYX_BACKUP_MIN_FREE_MB = old;
  }
});

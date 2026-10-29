import { expect, test } from "bun:test";
import { readdirSync, writeFileSync } from "node:fs";
import { DB_BACKUPS_DIR, getDbInstance } from "../src/lib/db/core";
import { backupNow } from "../server/backups";

test("a corrupt completed snapshot is rejected before publication", async () => {
  const db = getDbInstance();
  const original = db.backup;
  const oldHeadroom = process.env.STYX_BACKUP_MIN_FREE_MB;
  process.env.STYX_BACKUP_MIN_FREE_MB = "0";
  db.backup = async destination => { writeFileSync(destination, "not a sqlite database"); };
  try {
    await expect(backupNow("manual")).rejects.toThrow();
    expect(readdirSync(DB_BACKUPS_DIR!).filter(name => name.includes("_manual.sqlite") || name.startsWith(".backup-"))).toEqual([]);
  } finally {
    db.backup = original;
    if (oldHeadroom === undefined) delete process.env.STYX_BACKUP_MIN_FREE_MB;
    else process.env.STYX_BACKUP_MIN_FREE_MB = oldHeadroom;
  }
});

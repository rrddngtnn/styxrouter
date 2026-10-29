import { expect, test } from "bun:test";
import { readdirSync, writeFileSync } from "node:fs";
import { DB_BACKUPS_DIR, getDbInstance } from "../src/lib/db/core";
import { backupNow, listBackups } from "../server/backups";

test("failed asynchronous backup never appears in listing or remains on disk", async () => {
  const db = getDbInstance();
  const original = db.backup;
  db.backup = async (destination) => {
    writeFileSync(destination, "partial");
    await Promise.resolve();
    expect(listBackups().some((item) => item.reason === "manual")).toBe(false);
    throw new Error("simulated failure");
  };
  process.env.STYX_BACKUP_MIN_FREE_MB = "0";
  try {
    await expect(backupNow("manual")).rejects.toThrow("simulated failure");
    expect(readdirSync(DB_BACKUPS_DIR!).some((name) => name.includes("manual"))).toBe(false);
  } finally { db.backup = original; }
});

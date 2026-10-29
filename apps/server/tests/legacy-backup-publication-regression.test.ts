import { expect, test } from "bun:test";
import { readdirSync, writeFileSync } from "node:fs";
import { DB_BACKUPS_DIR, getDbInstance } from "../src/lib/db/core";
import { backupDbFile, listDbBackups } from "../src/lib/db/backup";

test("legacy backup does not publish a partial or failed snapshot", async () => {
  const db = getDbInstance();
  const original = db.backup;
  let reject!: (error: Error) => void;
  db.backup = (destination) => { writeFileSync(destination, "partial"); return new Promise((_resolve, r) => { reject = r; }); };
  try {
    backupDbFile("manual");
    expect((await listDbBackups()).some(b => b.reason === "manual")).toBe(false);
    reject(new Error("fixture failure"));
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(readdirSync(DB_BACKUPS_DIR!).some(name => name.includes("manual"))).toBe(false);
  } finally { db.backup = original; }
});

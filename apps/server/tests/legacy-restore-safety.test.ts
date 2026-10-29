import { expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DB_BACKUPS_DIR, SQLITE_FILE, getDbInstance } from "../src/lib/db/core";
import { restoreDbBackup } from "../src/lib/db/backup";

test("restore failure after validation preserves the live database", async () => {
  const db = getDbInstance();
  db.exec("CREATE TABLE restore_safety_marker (value TEXT); INSERT INTO restore_safety_marker VALUES ('keep')");
  const dir = DB_BACKUPS_DIR!;
  mkdirSync(dir, { recursive: true });
  const id = "db_restore_fixture_manual.sqlite";
  const backup = join(dir, id);
  await db.backup(backup);
  const remove = setTimeout(() => rmSync(backup, { force: true }), 100);
  try {
    await expect(restoreDbBackup(id)).rejects.toThrow();
    expect(existsSync(SQLITE_FILE!)).toBe(true);
    expect(getDbInstance().prepare("SELECT value FROM restore_safety_marker").get()).toEqual({ value: "keep" });
  } finally { clearTimeout(remove); rmSync(backup, { force: true }); }
});

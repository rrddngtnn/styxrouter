import { expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DB_BACKUPS_DIR, getDbInstance } from "../src/lib/db/core";
import { restoreDbBackup } from "../src/lib/db/backup";

test("disabled restore does not checkpoint or discard the live WAL", async () => {
  const db = getDbInstance();
  db.exec("CREATE TABLE wal_restore_marker (value TEXT); INSERT INTO wal_restore_marker VALUES ('keep')");
  mkdirSync(DB_BACKUPS_DIR!, { recursive: true });
  const id = "db_fixture_manual.sqlite";
  await db.backup(join(DB_BACKUPS_DIR!, id));
  const original = db.pragma;
  db.pragma = (sql, options) => {
    if (sql.startsWith("wal_checkpoint")) throw new Error("unexpected checkpoint");
    return original(sql, options);
  };
  try {
    await expect(restoreDbBackup(id)).rejects.toThrow(/online restore.*disabled/i);
    expect(getDbInstance().prepare("SELECT value FROM wal_restore_marker").get()).toEqual({ value: "keep" });
  } finally { db.pragma = original; }
});
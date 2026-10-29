import { expect, test } from "bun:test";
import { mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DB_BACKUPS_DIR, getDbInstance } from "../src/lib/db/core";
import { restoreDbBackup } from "../src/lib/db/backup";

test("disabled restore neither starts nor publishes a pre-restore backup", async () => {
  const dir = DB_BACKUPS_DIR!;
  mkdirSync(dir, { recursive: true });
  const db = getDbInstance();
  const id = "db_fixture_manual.sqlite";
  await db.backup(join(dir, id));
  const baseline = readdirSync(dir).sort();
  const original = db.backup;
  db.backup = async () => { throw new Error("unexpected backup"); };
  try {
    await expect(restoreDbBackup(id)).rejects.toThrow(/online restore.*disabled/i);
    expect(readdirSync(dir).sort()).toEqual(baseline);
  } finally { db.backup = original; }
});
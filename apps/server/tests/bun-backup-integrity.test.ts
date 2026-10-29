import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBunSqliteAdapter } from "../src/lib/db/adapters/bunSqliteAdapter";

test("backup includes committed WAL data while a reader prevents checkpoint", async () => {
  const dir = mkdtempSync(join(tmpdir(), "styx-wal-backup-"));
  const file = join(dir, "source.sqlite");
  const backup = join(dir, "backup.sqlite");
  const writer = new Database(file);
  let reader: Database | undefined;
  try {
    writer.exec("PRAGMA journal_mode=WAL; CREATE TABLE records(value TEXT); INSERT INTO records VALUES ('old'); PRAGMA wal_checkpoint(TRUNCATE)");
    reader = new Database(file);
    reader.exec("BEGIN");
    reader.query("SELECT * FROM records").all();
    writer.exec("INSERT INTO records VALUES ('new')");
    await createBunSqliteAdapter(writer, file).backup(backup);
    const snapshot = new Database(backup, { readonly: true });
    try {
      expect(snapshot.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
      expect(snapshot.query("SELECT value FROM records ORDER BY value").all()).toEqual([{ value: "new" }, { value: "old" }]);
    } finally { snapshot.close(); }
  } finally { reader?.exec("ROLLBACK"); reader?.close(); writer.close(); rmSync(dir, { recursive: true, force: true }); }
});

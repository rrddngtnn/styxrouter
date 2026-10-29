import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqlJsAdapter } from "../src/lib/db/adapters/sqljsAdapter";

test("sql.js backup captures state at invocation before later writes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sqljs-backup-"));
  const db = await createSqlJsAdapter(":memory:");
  try {
    db.exec("CREATE TABLE marker(value TEXT); INSERT INTO marker VALUES ('before')");
    const pending = db.backup(join(dir, "backup.sqlite"));
    db.exec("INSERT INTO marker VALUES ('after')");
    db.checkpoint();
    await pending;
    const snapshot = new Database(join(dir, "backup.sqlite"), { readonly: true });
    try { expect(snapshot.query("SELECT value FROM marker").all()).toEqual([{ value: "before" }]); }
    finally { snapshot.close(); }
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
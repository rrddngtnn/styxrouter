import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { DB_BACKUPS_DIR, getDbInstance } from "../src/lib/db/core";
import { backupDbFile } from "../src/lib/db/backup";

test("concurrent legacy backup return values identify their published snapshots", async () => {
  const db = getDbInstance();
  const original = db.backup;
  const realDate = globalThis.Date;
  const fixed = realDate.now();
  class FixedDate extends realDate {
    constructor(...args: ConstructorParameters<typeof Date>) { super(...(args.length ? args : [fixed]) as [number]); }
    static now() { return fixed; }
  }
  const finish: Array<() => void> = [];
  db.backup = (destination) => new Promise<void>(resolve => {
    const contents = `snapshot-${finish.length}`;
    finish.push(() => { const snapshot = new Database(destination); snapshot.exec("CREATE TABLE marker (value TEXT)"); snapshot.query("INSERT INTO marker VALUES (?)").run(contents); snapshot.close(); resolve(); });
  });
  globalThis.Date = FixedDate as DateConstructor;
  try {
    const first = backupDbFile("manual");
    const second = backupDbFile("manual");
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first!.filename).not.toBe(second!.filename);
    expect(existsSync(join(DB_BACKUPS_DIR!, first!.filename))).toBe(false);
    // Complete in reverse order to exercise asynchronous publication.
    finish[1](); finish[0]();
    await new Promise(resolve => setTimeout(resolve, 10));
    for (const [result, expected] of [[first!, "snapshot-0"], [second!, "snapshot-1"]] as const) {
      const snapshot = new Database(join(DB_BACKUPS_DIR!, result.filename), { readonly: true });
      try { expect(snapshot.query("SELECT value FROM marker").get()).toEqual({ value: expected }); }
      finally { snapshot.close(); }
    }
  } finally { db.backup = original; globalThis.Date = realDate; }
});

import { expect, test } from "bun:test";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DB_BACKUPS_DIR, SQLITE_FILE, getDbInstance } from "../src/lib/db/core";
import { restoreDbBackup } from "../src/lib/db/backup";

test("legacy online restore fails closed while another process writes SQLite", async () => {
  const db = getDbInstance();
  db.exec("CREATE TABLE cross_process_marker (value TEXT)");
  mkdirSync(DB_BACKUPS_DIR!, { recursive: true });
  const id = "db_cross_process_manual.sqlite";
  await db.backup(join(DB_BACKUPS_DIR!, id));
  const ready = join(DB_BACKUPS_DIR!, "writer-ready");
  const writer = Bun.spawn([process.execPath, "-e", `
    const { Database } = require('bun:sqlite');
    const fs = require('node:fs');
    const db = new Database(process.argv[1]);
    db.run("INSERT INTO cross_process_marker VALUES ('committed by second process')");
    fs.writeFileSync(process.argv[2], 'ready');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);
    db.close();
  `, SQLITE_FILE!, ready], { stdout: "ignore", stderr: "inherit" });
  try {
    for (let i = 0; i < 200 && !existsSync(ready); i++) await Bun.sleep(10);
    expect(existsSync(ready)).toBe(true);
    await expect(restoreDbBackup(id)).rejects.toThrow(/online restore.*disabled/i);
    expect(getDbInstance().prepare("SELECT value FROM cross_process_marker").all()).toEqual([
      { value: "committed by second process" },
    ]);
  } finally {
    writer.kill();
    await writer.exited;
  }
});

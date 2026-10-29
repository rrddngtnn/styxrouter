import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DB_BACKUPS_DIR, getDbInstance } from "../src/lib/db/core";
import { backupDbFile } from "../src/lib/db/backup";

async function waitFor(predicate: () => boolean) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("timed out waiting for backup");
}

test("characterization: delayed legacy backup may snapshot a later mutation", async () => {
  const db = getDbInstance();
  db.exec("CREATE TABLE prewrite_order_fixture (value TEXT); INSERT INTO prewrite_order_fixture VALUES ('before')");
  const original = db.backup;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  db.backup = async (destination) => {
    await gate;
    db.exec(`VACUUM INTO '${destination.replace(/'/g, "''")}'`);
  };
  try {
    const result = backupDbFile("manual");
    expect(result).not.toBeNull();
    db.exec("UPDATE prewrite_order_fixture SET value = 'after'");
    release();
    const file = join(DB_BACKUPS_DIR!, result!.filename);
    await waitFor(() => existsSync(file));
    const snapshot = new Database(file, { readonly: true });
    try { expect(snapshot.query("SELECT value FROM prewrite_order_fixture").get()).toEqual({ value: "after" }); }
    finally { snapshot.close(); }
  } finally { release(); db.backup = original; }
});

test("legacy backup reports a filename before a later failure and never publishes it", async () => {
  const db = getDbInstance();
  const original = db.backup;
  let reject!: (error: Error) => void;
  db.backup = () => new Promise((_resolve, rejectPromise) => { reject = rejectPromise; });
  try {
    const result = backupDbFile("manual");
    expect(result).not.toBeNull();
    const file = join(DB_BACKUPS_DIR!, result!.filename);
    reject(new Error("injected backup failure"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(existsSync(file)).toBe(false);
  } finally { db.backup = original; }
});

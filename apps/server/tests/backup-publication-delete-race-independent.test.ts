import { expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { join } from "node:path";
import { DB_BACKUPS_DIR, getDbInstance } from "../src/lib/db/core";
import { backupNow } from "../server/backups";

test("a deleted published name is not reused by a concurrent backup", async () => {
  process.env.STYX_BACKUP_MIN_FREE_MB = "0";
  const db = getDbInstance();
  const originalBackup = db.backup;
  const RealDate = globalThis.Date;
  const fixed = RealDate.now();
  class FixedDate extends RealDate {
    constructor(...args: ConstructorParameters<typeof Date>) { super(...(args.length ? args : [fixed]) as [number]); }
    static now() { return fixed; }
  }
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { entered = resolve; });
  let calls = 0;
  db.backup = async (destination) => {
    if (++calls === 2) { entered(); await gate; }
    return originalBackup.call(db, destination);
  };
  globalThis.Date = FixedDate as DateConstructor;
  try {
    const first = backupNow("manual");
    const second = backupNow("manual");
    await started;
    const a = await first;
    expect(a.ok).toBe(true);
    if (!a.ok) throw new Error(a.error);
    unlinkSync(join(DB_BACKUPS_DIR!, a.filename));
    release();
    const b = await second;
    expect(b.ok).toBe(true);
    if (!b.ok) throw new Error(b.error);
    expect(b.filename).not.toBe(a.filename);
  } finally { release(); db.backup = originalBackup; globalThis.Date = RealDate; }
});

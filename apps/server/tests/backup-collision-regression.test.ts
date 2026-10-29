import { expect, test } from "bun:test";
import { getDbInstance } from "../src/lib/db/core";
import { backupNow } from "../server/backups";

test("concurrent backups in the same millisecond both publish distinct snapshots", async () => {
  getDbInstance();
  process.env.STYX_BACKUP_MIN_FREE_MB = "0";
  const RealDate = globalThis.Date;
  const fixed = RealDate.now();
  class FixedDate extends RealDate {
    constructor(...args: ConstructorParameters<typeof Date>) { super(...(args.length ? args : [fixed]) as [number]); }
    static now() { return fixed; }
  }
  globalThis.Date = FixedDate as DateConstructor;
  try {
    const [a, b] = await Promise.all([backupNow("manual"), backupNow("manual")]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.filename).not.toBe(b.filename);
  } finally { globalThis.Date = RealDate; }
});

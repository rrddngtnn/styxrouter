import { expect, test } from "bun:test";
import { getDbInstance } from "../src/lib/db/core";
import { listBackups, startBackupScheduler } from "../server/backups";

test("overlapping scheduler ticks start only one scheduled snapshot", async () => {
  const db = getDbInstance();
  const originalBackup = db.backup;
  const originalTimeout = globalThis.setTimeout;
  const originalInterval = globalThis.setInterval;
  const testMode = process.env.STYX_TEST_MODE;
  const free = process.env.STYX_BACKUP_MIN_FREE_MB;
  const interval = process.env.STYX_BACKUP_INTERVAL_HOURS;
  let tick!: () => Promise<void>;
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const entered = new Promise<void>((resolve) => { started = resolve; });
  let calls = 0;
  db.backup = async (destination) => { calls++; started(); await gate; return originalBackup.call(db, destination); };
  globalThis.setTimeout = ((fn: typeof tick) => { tick = fn; return { unref() {} }; }) as any;
  globalThis.setInterval = (() => ({ unref() {} })) as any;
  delete process.env.STYX_TEST_MODE;
  process.env.STYX_BACKUP_MIN_FREE_MB = "0";
  process.env.STYX_BACKUP_INTERVAL_HOURS = "24";
  try {
    startBackupScheduler();
    const first = tick();
    await entered;
    const second = tick();
    expect(calls).toBe(1);
    release();
    await Promise.all([first, second]);
    expect(listBackups().filter((item) => item.reason === "scheduled")).toHaveLength(1);
  } finally {
    release(); db.backup = originalBackup; globalThis.setTimeout = originalTimeout; globalThis.setInterval = originalInterval;
    if (testMode === undefined) delete process.env.STYX_TEST_MODE; else process.env.STYX_TEST_MODE = testMode;
    if (free === undefined) delete process.env.STYX_BACKUP_MIN_FREE_MB; else process.env.STYX_BACKUP_MIN_FREE_MB = free;
    if (interval === undefined) delete process.env.STYX_BACKUP_INTERVAL_HOURS; else process.env.STYX_BACKUP_INTERVAL_HOURS = interval;
  }
});

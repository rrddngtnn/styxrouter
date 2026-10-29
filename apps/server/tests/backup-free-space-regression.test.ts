import { expect, test } from "bun:test";
import { closeSync, mkdtempSync, openSync, rmSync, statfsSync, truncateSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backupHasSpace } from "../server/backups";

test("free-space guard counts WAL bytes", () => {
  const dir = mkdtempSync(join(tmpdir(), "backup-space-"));
  const db = join(dir, "storage.sqlite");
  try {
    closeSync(openSync(db, "w"));
    truncateSync(db, 4096);
    closeSync(openSync(`${db}-wal`, "w"));
    const fs = statfsSync(dir);
    truncateSync(`${db}-wal`, Math.floor(fs.bavail * fs.bsize / 2) + 1);
    expect(backupHasSpace(db, dir, 0n)).toBe(false);
    unlinkSync(`${db}-wal`);
    expect(backupHasSpace(db, dir, 0n)).toBe(true);
    expect(backupHasSpace(db, dir, BigInt(fs.bavail) * BigInt(fs.bsize) + 1n)).toBe(false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

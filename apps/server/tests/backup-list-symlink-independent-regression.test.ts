import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listBackups, pruneScheduled } from "../server/backups";

test("dangling and external symlinks do not break listing or count as scheduled backups", () => {
  const dir = mkdtempSync(join(tmpdir(), "backup-links-"));
  try {
    writeFileSync(join(dir, "db_real_scheduled.sqlite"), "snapshot");
    symlinkSync(join(dir, "missing"), join(dir, "db_missing_scheduled.sqlite"));
    symlinkSync(join(dir, "db_real_scheduled.sqlite"), join(dir, "db_link_scheduled.sqlite"));
    expect(listBackups(dir).map(item => item.filename)).toEqual(["db_real_scheduled.sqlite"]);
    expect(pruneScheduled(dir, 1)).toEqual([]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

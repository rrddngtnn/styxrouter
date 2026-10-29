import { expect, test } from "bun:test";
import { join } from "node:path";
import { openDatabaseAsync } from "../src/lib/db/adapters/driverFactory";

test("forced package boot and test mode cannot bypass file-backed sql.js refusal", async () => {
  const old = { ...process.env };
  try {
    process.env.STYX_PACK_BOOT_SMOKE = "1";
    process.env.STYX_PACK_BOOT_FORCE_SQLJS = "1";
    process.env.STYX_TEST_MODE = "1";
    await expect(openDatabaseAsync(join(process.env.TMPDIR!, "boot.sqlite"))).rejects.toThrow("file-backed sql.js is disabled");
    const memory = await openDatabaseAsync(":memory:");
    try { expect(memory.driver).toBe("sql.js"); } finally { memory.close(); }
  } finally {
    for (const key of ["STYX_PACK_BOOT_SMOKE", "STYX_PACK_BOOT_FORCE_SQLJS", "STYX_TEST_MODE"]) {
      if (old[key] === undefined) delete process.env[key]; else process.env[key] = old[key];
    }
  }
});

test("normal persistent boot uses a native driver", async () => {
  const db = await openDatabaseAsync(join(process.env.TMPDIR!, "native.sqlite"));
  try {
    expect(db.driver).not.toBe("sql.js");
    db.exec("CREATE TABLE boot_marker (value INTEGER)");
  } finally { db.close(); }
});

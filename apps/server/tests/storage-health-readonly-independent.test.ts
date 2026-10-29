import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("vacuum health does not initialize or create a database when none is open", () => {
  const dir = mkdtempSync(join(tmpdir(), "health-readonly-"));
  try {
    const script = `import { createStorageHealthApi } from './server/storageHealth.ts'; const r = await createStorageHealthApi().request('/vacuum'); console.log('RESULT:' + JSON.stringify(await r.json()));`;
    const child = Bun.spawnSync([process.execPath, "-e", script], { cwd: join(import.meta.dir, ".."), env: { ...process.env, DATA_DIR: dir, STYX_TEST_MODE: "1" }, stdout: "pipe", stderr: "pipe" });
    expect(child.exitCode).toBe(0);
    expect(child.stdout.toString()).toContain('RESULT:{"lastSuccessfulSchedulerVacuumAt":null}');
    expect(existsSync(join(dir, "storage.sqlite"))).toBe(false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("storage health reports inaccessible database and WAL as unavailable", () => {
  const dir = mkdtempSync(join(tmpdir(), "health-inaccessible-"));
  const blocked = join(dir, "blocked");
  try {
    mkdirSync(blocked);
    writeFileSync(join(blocked, "storage.sqlite"), "fixture");
    writeFileSync(join(blocked, "storage.sqlite-wal"), "fixture");
    const script = `import { createStorageHealthApi } from './server/storageHealth.ts'; const { chmodSync } = await import('node:fs'); chmodSync(${JSON.stringify(blocked)}, 0); const r = await createStorageHealthApi().request('/'); console.log('RESULT:' + JSON.stringify(await r.json()));`;
    const child = Bun.spawnSync([process.execPath, "-e", script], { cwd: join(import.meta.dir, ".."), env: { ...process.env, DATA_DIR: blocked, STYX_TEST_MODE: "1" }, stdout: "pipe", stderr: "pipe" });
    expect(child.exitCode).toBe(0);
    expect(child.stdout.toString()).toContain('RESULT:{"databaseBytes":null,"walBytes":null}');
  } finally { chmodSync(blocked, 0o700); rmSync(dir, { recursive: true, force: true }); }
});

import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const root = resolve(import.meta.dir, "../../..");

test("root panel test command runs panel tests without bypassing the server guard", () => {
  const result = Bun.spawnSync([process.execPath, "run", "panel:test", "tests/locale-format.test.ts"], {
    cwd: root, env: { ...process.env, STYX_ISOLATED_TEST: "" }, stdout: "pipe", stderr: "pipe",
  });
  expect(`${result.exitCode}: ${result.stdout} ${result.stderr}`).toStartWith("0:");
  expect(result.stderr.toString()).toContain("formatters honor selected locale");
});

test("root direct test remains blocked before it can touch data", () => {
  const sandbox = mkdtempSync(resolve(tmpdir(), "styx-root-guard-"));
  try {
    const sentinel = resolve(sandbox, "sentinel");
    writeFileSync(sentinel, "safe");
    const fixture = resolve(sandbox, "unsafe.test.ts");
    writeFileSync(fixture, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(sentinel)}, 'unsafe');`);
    const result = Bun.spawnSync([process.execPath, "test", fixture], {
      cwd: root, env: { ...process.env, STYX_ISOLATED_TEST: "", HOME: sandbox, DATA_DIR: sandbox }, stdout: "pipe", stderr: "pipe",
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("isolated test runner");
    expect(readFileSync(sentinel, "utf8")).toBe("safe");
  } finally { rmSync(sandbox, { recursive: true, force: true }); }
});

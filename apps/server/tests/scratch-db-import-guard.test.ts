import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const server = resolve(import.meta.dir, "..");
const core = resolve(server, "src/lib/db/core.ts");

test("direct scratch probe cannot import the DB before isolation", () => {
  const root = mkdtempSync(join(tmpdir(), "guard-repro-"));
  try {
    const data = join(root, "operator"); mkdirSync(data);
    const sentinel = join(data, "storage.sqlite"); writeFileSync(sentinel, "sentinel");
    const script = join(root, "scratch-probe.ts");
    writeFileSync(script, `import { DATA_DIR } from ${JSON.stringify(core)}; console.log(DATA_DIR);`);
    const result = Bun.spawnSync([process.execPath, script], { cwd: server, env: { ...process.env, HOME: root, DATA_DIR: data, NODE_ENV: "production", STYX_ISOLATED_TEST: "" }, stdout: "pipe", stderr: "pipe" });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("isolated test runner");
    expect(readFileSync(sentinel, "utf8")).toBe("sentinel");
    const evalResult = Bun.spawnSync([process.execPath, "-e", `import { DATA_DIR } from ${JSON.stringify(core)}; console.log(DATA_DIR);`], { cwd: server, env: { ...process.env, HOME: root, DATA_DIR: data, NODE_ENV: "production", STYX_ISOLATED_TEST: "" }, stdout: "pipe", stderr: "pipe" });
    expect(evalResult.exitCode).not.toBe(0);
    expect(evalResult.stderr.toString()).toContain("isolated test runner");
    expect(readFileSync(sentinel, "utf8")).toBe("sentinel");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("normal production entrypoint and isolated test both import with private data directories", () => {
  const root = mkdtempSync(join(tmpdir(), "guard-positive-"));
  try {
    const data = join(root, "private");
    const script = join(root, "server.ts");
    writeFileSync(script, `import { DATA_DIR } from ${JSON.stringify(core)}; console.log(DATA_DIR);`);
    const scratch = join(root, "configured-scratch"); mkdirSync(scratch);
    const env = { ...process.env, HOME: root, TMPDIR: scratch, DATA_DIR: data, NODE_ENV: "production", STYX_ISOLATED_TEST: "" };
    const normal = Bun.spawnSync([process.execPath, script], { cwd: server, env, stdout: "pipe", stderr: "pipe" });
    expect(`${normal.exitCode}: ${normal.stderr}`).toStartWith("0:");
    expect(normal.stdout.toString()).toContain(data);
    const fixture = join(root, "probe.test.ts");
    writeFileSync(fixture, `import { test, expect } from 'bun:test'; import { DATA_DIR } from ${JSON.stringify(core)}; test('isolated', () => expect(DATA_DIR).toBe(process.env.DATA_DIR));`);
    const isolated = Bun.spawnSync([process.execPath, resolve(server, "scripts/test-isolated.ts"), fixture], { cwd: server, env, stdout: "pipe", stderr: "pipe" });
    expect(`${isolated.exitCode}: ${isolated.stdout} ${isolated.stderr}`).toStartWith("0:");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

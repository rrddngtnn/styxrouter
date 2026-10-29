import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { startTestServer } from "./helpers/start-test-server";

test("direct bun test refuses database initialization before touching an operator directory", () => {
  const root = mkdtempSync(join(tmpdir(), "styx-direct-guard-"));
  try {
    const data = join(root, "operator-data");
    mkdirSync(data);
    const sentinel = join(data, "storage.sqlite");
    writeFileSync(sentinel, "operator sentinel");
    const fixture = join(root, "direct.test.ts");
    const core = resolve(import.meta.dir, "../src/lib/db/core.ts");
    writeFileSync(fixture, `import { test } from 'bun:test'; import { DATA_DIR } from ${JSON.stringify(core)}; test('must not run', () => { if (DATA_DIR) throw new Error('database import ran'); });`);
    const env = { ...process.env, HOME: root, DATA_DIR: data, NODE_ENV: "production", STYX_ISOLATED_TEST: "" };
    const result = Bun.spawnSync([process.execPath, "test", fixture], { cwd: resolve(import.meta.dir, ".."), env, stdout: "pipe", stderr: "pipe" });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("isolated test runner");
    expect(readFileSync(sentinel, "utf8")).toBe("operator sentinel");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("runner isolates files and never uses the caller's home or DATA_DIR", () => {
  const root = mkdtempSync(join(tmpdir(), "styx-runner-proof-"));
  try {
    const home = join(root, "home");
    const data = join(root, "operator-data");
    mkdirSync(home); mkdirSync(data);
    const sentinel = join(data, "storage.sqlite");
    writeFileSync(sentinel, "operator sentinel");
    const shared = join(root, "shared.ts");
    writeFileSync(shared, `export const initial = process.env.DATA_DIR; export const state = { value: 0 };`);
    const first = join(root, "first.test.ts");
    const second = join(root, "second.test.ts");
    writeFileSync(first, `import { test, expect } from 'bun:test'; import { initial, state } from './shared'; test('first', () => { expect(initial).toBe(process.env.DATA_DIR); expect(initial).not.toBe(process.env.OPERATOR_DATA); for (const key of ['CURSOR_DATA_DIR', 'QODER_CLI_CONFIG_DIR', 'XDG_CACHE_HOME']) expect(process.env[key]).not.toBe(process.env.OPERATOR_DATA); state.value = 1; });`);
    writeFileSync(second, `import { test, expect } from 'bun:test'; import { initial, state } from './shared'; test('second', () => { expect(initial).toBe(process.env.DATA_DIR); expect(initial).not.toBe(process.env.OPERATOR_DATA); expect(state.value).toBe(0); });`);
    const result = Bun.spawnSync([process.execPath, resolve(import.meta.dir, "../scripts/test-isolated.ts"), first, second], {
      cwd: resolve(import.meta.dir, ".."),
      env: { ...process.env, HOME: home, DATA_DIR: data, OPERATOR_DATA: data,
        CURSOR_DATA_DIR: data, QODER_CLI_CONFIG_DIR: data, XDG_CACHE_HOME: data },
      stdout: "pipe", stderr: "pipe",
    });
    expect(`${result.exitCode}: ${result.stdout.toString()} ${result.stderr.toString()}`).toStartWith("0:");
    expect(readFileSync(sentinel, "utf8")).toBe("operator sentinel");
    expect(existsSync(join(home, ".styx", "storage.sqlite"))).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("runner refuses a test with an occupied fixed port before it can contact the listener", () => {
  const root = mkdtempSync(join(tmpdir(), "styx-runner-port-"));
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("ok") });
  try {
    const fixture = join(root, "collision.test.ts");
    writeFileSync(fixture, `import { test } from 'bun:test'; import { writeFileSync } from 'node:fs'; const PORT = ${server.port}; test('must not run', () => { writeFileSync(${JSON.stringify(join(root, "ran"))}, String(PORT)); });`);
    const result = Bun.spawnSync([process.execPath, resolve(import.meta.dir, "../scripts/test-isolated.ts"), fixture], { stdout: "pipe", stderr: "pipe" });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("port");
    expect(existsSync(join(root, "ran"))).toBe(false);
  } finally { server.stop(true); rmSync(root, { recursive: true, force: true }); }
});

test("admin contracts run even when their former fixed port is occupied", async () => {
  const blocker = createServer();
  const ownsPort = await new Promise<boolean>((resolve, reject) => {
    blocker.once("error", (error: NodeJS.ErrnoException) => error.code === "EADDRINUSE" ? resolve(false) : reject(error));
    blocker.listen(21196, "127.0.0.1", () => resolve(true));
  });
  try {
    const result = Bun.spawnSync([process.execPath, resolve(import.meta.dir, "../scripts/test-isolated.ts"), "tests/admin2-contracts.test.ts"], {
      cwd: resolve(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe",
    });
    expect(`${result.exitCode}: ${result.stdout} ${result.stderr}`).toStartWith("0:");
  } finally {
    if (ownsPort) blocker.close();
  }
}, 30000);

test("server startup waits for the complete port marker across stdout chunks", async () => {
  const root = mkdtempSync(join(tmpdir(), "styx-runner-marker-"));
  try {
    const fixture = join(root, "fake-server");
    writeFileSync(fixture, `#!${process.execPath}\nprocess.stdout.write('STYX_TEST_LISTENING:51'); await Bun.sleep(150); process.stdout.write('234\\n'); await Bun.sleep(3000);`, { mode: 0o755 });
    const { proc, base } = await startTestServer(fixture, {});
    try { expect(base).toBe("http://127.0.0.1:51234"); } finally { proc.kill("SIGKILL"); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("runner redirects inherited writable path overrides", () => {
  const root = mkdtempSync(join(tmpdir(), "styx-runner-paths-"));
  try {
    const sentinel = join(root, "operator.log");
    writeFileSync(sentinel, "sentinel");
    const fixture = join(root, "paths.test.ts");
    writeFileSync(fixture, `import { test, expect } from 'bun:test'; import { appendFileSync } from 'node:fs'; test('paths', () => { for (const key of ['APP_LOG_FILE_PATH', 'CURSOR_DUMP_FILE', 'MEMORY_STATIC_CACHE_DIR', 'STYX_VNC_PROFILE_DIR']) expect(process.env[key] || '').not.toBe(process.env.OPERATOR_PATH); appendFileSync(process.env.APP_LOG_FILE_PATH!, 'test'); });`);
    const result = Bun.spawnSync([process.execPath, resolve(import.meta.dir, "../scripts/test-isolated.ts"), fixture], {
      cwd: resolve(import.meta.dir, ".."),
      env: { ...process.env, OPERATOR_PATH: sentinel, APP_LOG_FILE_PATH: sentinel, CURSOR_DUMP_FILE: sentinel, MEMORY_STATIC_CACHE_DIR: sentinel, STYX_VNC_PROFILE_DIR: sentinel },
      stdout: "pipe", stderr: "pipe",
    });
    expect(`${result.exitCode}: ${result.stdout} ${result.stderr}`).toStartWith("0:");
    expect(readFileSync(sentinel, "utf8")).toBe("sentinel");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

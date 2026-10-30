#!/usr/bin/env bun
// Bun shares a module cache and process.env across test files. Run each file in
// its own process, with an isolated home and data directory before any imports.
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

const serverDir = resolve(import.meta.dir, "..");
const inputs = process.argv.slice(2);
const files: string[] = [];
function collect(input: string) {
  const full = isAbsolute(input) ? input : resolve(serverDir, input);
  if (statSync(full).isDirectory()) {
    for (const name of readdirSync(full).sort()) {
      const child = join(full, name);
      if (statSync(child).isDirectory() || /\.(test|spec)\.[cm]?[jt]sx?$/.test(child)) collect(child);
    }
  } else if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(full)) files.push(full);
  else throw new Error(`Not a test file: ${input}`);
}
for (const input of inputs.length ? inputs : ["tests"]) collect(input);
if (!files.length) throw new Error("No test files found");

const root = mkdtempSync(join(tmpdir(), "styx-tests-"));
let failed = 0;
try {
  for (const [index, file] of files.entries()) {
    const sandbox = join(root, String(index));
    const home = join(sandbox, "home");
    const temp = join(sandbox, "tmp");
    const data = join(sandbox, "data");
    const work = join(sandbox, "work");
    for (const dir of [home, temp, data, work]) mkdirSync(dir, { recursive: true });
    // Preserve common server-relative paths without exposing top-level dotenv files.
    // These links are compatibility aids, not a write or security boundary.
    for (const name of readdirSync(serverDir)) {
      if (/^\.env(?:\.|$)/i.test(name)) continue;
      symlinkSync(join(serverDir, name), join(work, name));
    }
    // The legacy integration tests declare fixed PORT constants and poll health;
    // never let them mistake an existing listener for their own server.
    const source = readFileSync(file, "utf8");
    const ports = [...source.matchAll(/\bconst\s+PORT\s*=\s*(\d+)\s*;/g)].map((m) => Number(m[1]));
    let collision = false;
    for (const port of ports.filter((p) => p > 0 && p <= 65535)) {
      const available = await new Promise<boolean>((done) => {
        const probe = createServer();
        probe.once("error", () => done(false));
        probe.listen({ port, host: "127.0.0.1", exclusive: true }, () => probe.close(() => done(true)));
      });
      if (!available) { console.error(`Refusing ${file}: fixed port ${port} is unavailable`); collision = true; }
    }
    if (collision) { failed++; continue; }
    // Do not forward application secrets, path overrides, or runtime injection flags.
    // Fixtures may explicitly provide synthetic keys to their own subprocesses.
    // The default inherited cwd is dotenv-free. Explicit cwd changes, symlinks,
    // and absolute paths can reach the source tree: this is not an OS sandbox.
    const child = Bun.spawnSync([process.execPath, "test", "--no-env-file", file], {
      cwd: work,
      env: { PATH: process.env.PATH || "/usr/bin:/bin", NODE_ENV: "test", STYX_ISOLATED_TEST: "1", HOME: home, USERPROFILE: home, TMPDIR: temp, TMP: temp, TEMP: temp,
        APP_LOG_FILE_PATH: join(data, "app.log"),
        XDG_CONFIG_HOME: join(home, ".config"), XDG_DATA_HOME: join(home, ".local", "share"),
        XDG_CACHE_HOME: join(home, ".cache"), CURSOR_DATA_DIR: join(data, "cursor"),
        QODER_CLI_CONFIG_DIR: join(data, "qoder"), STYX_DATA_DIR: data,
        VIBEPROXY_DATA_DIR: data, DATA_DIR: data,
        // No secrets seeded here on purpose: the runner drops inherited secrets so
        // each test starts from a clean environment (asserted by
        // runner-clean-env-regression.test.ts). A test that needs JWT_SECRET,
        // API_KEY_SECRET, STORAGE_ENCRYPTION_KEY or INITIAL_PASSWORD must set them
        // itself (process.env.X = ...) before importing the server.
        STYX_TEST_MODE: "1" },
      stdin: "inherit", stdout: "inherit", stderr: "inherit",
    });
    if (child.exitCode !== 0) failed++;
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log(`\nIsolated test files: ${files.length - failed} passed, ${failed} failed (${files.length} total)`);
if (failed) process.exitCode = 1;

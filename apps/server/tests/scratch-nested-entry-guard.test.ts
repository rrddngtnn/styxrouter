import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const server = resolve(import.meta.dir, "..");
const core = resolve(server, "src/lib/db/core.ts");

test("nested scratch entrypoints including symlink aliases are refused before database paths are touched", () => {
  const root = mkdtempSync(join(tmpdir(), "nested-guard-"));
  try {
    const scratch = join(root, "configured-scratch");
    const nested = join(scratch, "deep", "nested");
    const home = join(root, "home");
    const data = join(root, "data");
    for (const dir of [nested, home, data]) mkdirSync(dir, { recursive: true });
    const sentinel = join(data, "storage.sqlite");
    writeFileSync(sentinel, "sentinel");
    const script = join(nested, "ordinary.ts");
    writeFileSync(script, `import { DATA_DIR } from ${JSON.stringify(core)}; console.log(DATA_DIR);`);
    const alias = join(root, "entry.ts");
    symlinkSync(script, alias);
    const env = { ...process.env, HOME: home, USERPROFILE: home, TMPDIR: scratch, DATA_DIR: data, STYX_DATA_DIR: data, VIBEPROXY_DATA_DIR: data, NODE_ENV: "production", STYX_ISOLATED_TEST: "" };
    for (const entry of [script, alias]) {
      const result = Bun.spawnSync([process.execPath, entry], { cwd: server, env, stdout: "pipe", stderr: "pipe" });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr.toString()).toContain("isolated test runner");
      expect(readFileSync(sentinel, "utf8")).toBe("sentinel");
    }
    const outside = join(root, "configured-scratch-sibling");
    mkdirSync(outside);
    const legitimate = join(outside, "server.ts");
    writeFileSync(legitimate, `import { DATA_DIR } from ${JSON.stringify(core)}; console.log(DATA_DIR);`);
    const allowed = Bun.spawnSync([process.execPath, legitimate], { cwd: server, env, stdout: "pipe", stderr: "pipe" });
    expect(`${allowed.exitCode}: ${allowed.stderr}`).toStartWith("0:");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

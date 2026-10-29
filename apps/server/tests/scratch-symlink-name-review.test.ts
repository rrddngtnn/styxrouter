import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const server = resolve(import.meta.dir, "..");
const core = resolve(server, "src/lib/db/core.ts");

test("symlink to a named scratch probe outside TMPDIR is refused", () => {
  const root = mkdtempSync(join(tmpdir(), "scratch-alias-review-"));
  try {
    const scratch = join(root, "tmp"); const data = join(root, "data");
    mkdirSync(scratch); mkdirSync(data);
    const sentinel = join(data, "storage.sqlite"); writeFileSync(sentinel, "sentinel");
    const target = join(root, "scratch-probe.ts"); const alias = join(root, "server.ts");
    writeFileSync(target, `import { DATA_DIR } from ${JSON.stringify(core)}; console.log(DATA_DIR);`);
    symlinkSync(target, alias);
    const env = { ...process.env, HOME: root, USERPROFILE: root, TMPDIR: scratch, DATA_DIR: data, STYX_DATA_DIR: data, VIBEPROXY_DATA_DIR: data, NODE_ENV: "production", STYX_ISOLATED_TEST: "" };
    const result = Bun.spawnSync([process.execPath, alias], { cwd: server, env, stdout: "pipe", stderr: "pipe" });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("isolated test runner");
    expect(readFileSync(sentinel, "utf8")).toBe("sentinel");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

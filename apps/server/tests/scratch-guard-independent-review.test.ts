import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const core = resolve(import.meta.dir, "../src/lib/db/core.ts");

test("legitimate production server named test-server can import database core", () => {
  const root = mkdtempSync(join(tmpdir(), "guard-entry-"));
  try {
    const data = join(root, "data"); mkdirSync(data);
    const script = join(root, "test-server.ts");
    writeFileSync(script, `import { DATA_DIR } from ${JSON.stringify(core)}; console.log(DATA_DIR);`);
    const scratch = join(root, "configured-scratch"); mkdirSync(scratch);
    const result = Bun.spawnSync([process.execPath, script], { env: { ...process.env, HOME: root, TMPDIR: scratch, DATA_DIR: data, STYX_DATA_DIR: data, NODE_ENV: "production", STYX_ISOLATED_TEST: "" }, stdout: "pipe", stderr: "pipe" });
    expect(`${result.exitCode}: ${result.stderr}`).toStartWith("0:");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

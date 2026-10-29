import { expect, test } from "bun:test";
import { resolve } from "node:path";

// The server intentionally still has unrelated TypeScript baseline diagnostics.
test("provider window cost queries match the SQLite adapter type contract", () => {
  const root = resolve(import.meta.dir, "../../..");
  const result = Bun.spawnSync([
    resolve(root, "apps/panel/node_modules/.bin/tsc"),
    "--noEmit", "--pretty", "false", "-p", resolve(root, "apps/server/tsconfig.json"),
  ], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const output = new TextDecoder().decode(result.stdout);
  expect([0, 2]).toContain(result.exitCode);
  expect(output.split("\n").filter((line) => line.includes("src/lib/usage/providerWindowCosts.ts") && line.includes("error TS"))).toEqual([]);
}, 120_000);

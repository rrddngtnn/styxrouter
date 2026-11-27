import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("GLM quota response handling has no TypeScript diagnostics", () => {
  const root = resolve(import.meta.dir, "../../..");
  const result = Bun.spawnSync([
    process.execPath, "--bun", resolve(root, "apps/panel/node_modules/.bin/tsc"),
    "--noEmit", "--pretty", "false", "-p", resolve(root, "apps/server/tsconfig.json"),
  ], { cwd: root, stdout: "pipe", stderr: "pipe" });
  expect([0, 2]).toContain(result.exitCode);
  const output = new TextDecoder().decode(result.stdout);
  expect(output.split("\n").filter((line) => /open-sse\/services\/usage\/glm\.ts\(.*error TS/.test(line))).toEqual([]);
}, 120_000);

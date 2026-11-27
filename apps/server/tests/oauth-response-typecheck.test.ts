import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("Kiro and CodeBuddy Intl OAuth responses typecheck against their endpoint contracts", () => {
  const root = resolve(import.meta.dir, "../../..");
  const result = Bun.spawnSync([
    process.execPath, "--bun", resolve(root, "apps/panel/node_modules/.bin/tsc"),
    "--noEmit", "--pretty", "false", "-p", resolve(root, "apps/server/tsconfig.json"),
  ], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const output = new TextDecoder().decode(result.stdout);
  expect([0, 2]).toContain(result.exitCode);
  expect(output.split("\n").filter((line) => /src\/lib\/oauth\/(services\/kiro|providers\/codebuddy-intl)\.ts\(.*error TS/.test(line))).toEqual([]);
}, 120_000);

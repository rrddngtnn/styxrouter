import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("server and its test helpers typecheck with Bun", () => {
  const root = resolve(import.meta.dir, "../../..");
  const result = Bun.spawnSync([process.execPath, "--bun", resolve(root, "apps/server/node_modules/typescript/bin/tsc"), "--noEmit", "-p", resolve(root, "apps/server/tsconfig.json"), "--pretty", "false"], { cwd: root, stdout: "pipe", stderr: "pipe" });
  expect({ exitCode: result.exitCode, output: new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr) }).toEqual({ exitCode: 0, output: "" });
}, 120_000);

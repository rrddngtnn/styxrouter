import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("stream readers typecheck against the Node stream contract", () => {
  const root = resolve(import.meta.dir, "../../..");
  const result = Bun.spawnSync([
    resolve(root, "apps/panel/node_modules/.bin/tsc"),
    "--noEmit", "--pretty", "false", "-p", resolve(root, "apps/server/tsconfig.json"),
  ], { cwd: root, stdout: "pipe", stderr: "pipe" });
  expect([0, 2]).toContain(result.exitCode);
  const output = new TextDecoder().decode(result.stdout);
  const paths = ["open-sse/executors/context7-fetch.ts", "open-sse/handlers/chatCore/jsonBodyToSse.ts", "open-sse/services/streamRecovery.ts"];
  expect(output.split("\n").filter((line) => paths.some((path) => line.includes(path)) && line.includes("error TS"))).toEqual([]);
}, 120_000);

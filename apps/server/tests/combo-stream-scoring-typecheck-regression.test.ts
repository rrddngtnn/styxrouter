import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("combo, stream, scoring and mock helper contracts typecheck", () => {
  const server = resolve(import.meta.dir, "..");
  const result = Bun.spawnSync([process.execPath, "--bun", resolve(server, "node_modules/.bin/tsc"), "--noEmit", "--pretty", "false", "-p", resolve(server, "tsconfig.json")], { cwd: server, stdout: "pipe", stderr: "pipe" });
  expect([0, 2]).toContain(result.exitCode);
  const output = new TextDecoder().decode(result.stdout);
  const paths = ["open-sse/services/combo.ts", "open-sse/utils/progressTracker.ts", "open-sse/utils/sseHeartbeat.ts", "open-sse/utils/stream.ts", "src/lib/usage/comboForecast.ts", "src/lib/usage/comboHealth.ts", "src/lib/usage/comboScoringInspector.ts", "tests/helpers/token-auth-mock-server.ts"];
  expect(output.split("\n").filter((line) => paths.some((path) => line.includes(path)) && line.includes("error TS"))).toEqual([]);
}, 120_000);

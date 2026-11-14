import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { normalizeVideoTranscript } from "../src/lib/guardrails/videoBridgeHelpers";

describe("video transcript validation", () => {
  test("typechecks without diagnostics in the transcript helper", () => {
    const result = spawnSync(process.execPath, ["--bun", import.meta.dir + "/../node_modules/typescript/bin/tsc", "--noEmit", "--pretty", "false"], { cwd: import.meta.dir + "/..", encoding: "utf8" });
    expect(result.error).toBeUndefined();
    expect(result.stdout.split("\n").filter((line) => line.includes("src/lib/guardrails/videoBridgeHelpers.ts("))).toEqual([]);
  }, 60000);

  test("accepts cue arrays and rejects invalid confidence", () => {
    const cue = { text: " hello ", source: "client", start: 0, end: 1 };
    expect(normalizeVideoTranscript({ cues: [cue, cue] }, 2)).toEqual([
      { text: "hello", source: "client", startSeconds: 0, endSeconds: 1, confidence: 1 },
    ]);
    for (const confidence of ["0.5", null, NaN, -1, 2]) {
      expect(() => normalizeVideoTranscript([{ ...cue, confidence }], 2)).toThrow();
    }
  });
});

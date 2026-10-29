import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "styx-terra-effort-"));
process.env.STYX_TEST_MODE = "1";
const { splitCodexReasoningSuffix } = await import("../open-sse/executors/codex/reasoningSuffix.ts");
const { CodexExecutor } = await import("../open-sse/executors/codex.ts");
const { isModelAdvertisedByConnection } = await import("../src/domain/connectionModelRules.ts");
const { normalizeResponsesReasoningEffort } = await import("../open-sse/translator/request/openai-responses/helpers.ts");

test("Terra effort aliases resolve through account selection and Codex dispatch", () => {
  const executor = new CodexExecutor();
  const inventory = new Set(["gpt-6.1-terra"]);
  for (const [suffix, wireEffort] of [["low", "low"], ["medium", "medium"], ["high", "high"], ["xhigh", "xhigh"], ["max", "max"], ["ultra", "max"]]) {
    const model = `gpt-6.1-terra-${suffix}`;
    expect(splitCodexReasoningSuffix(model)).toEqual({ baseModel: "gpt-6.1-terra", effort: suffix });
    expect(isModelAdvertisedByConnection(`codex/${model}`, inventory, "codex")).toBe(true);
    const body = executor.transformRequest(model, { model, reasoning: { effort: "low" } }, true, {} as any) as any;
    expect(body.model).toBe("gpt-6.1-terra");
    expect(body.reasoning.effort).toBe(wireEffort);
  }
  expect(normalizeResponsesReasoningEffort("max", "codex/gpt-6.1-terra")).toBe("max");
});

test("unrelated max model names remain intact", () => {
  expect(splitCodexReasoningSuffix("gpt-6.1-sol-max")).toEqual({ baseModel: "gpt-6.1-sol-max", effort: null });
});

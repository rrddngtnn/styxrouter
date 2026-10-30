import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "styx-luna-ultra-"));
process.env.STYX_TEST_MODE = "1";

const { splitCodexReasoningSuffix, GPT_5_6_ULTRA_ALIAS_MODELS } = await import(
  "../open-sse/executors/codex/reasoningSuffix.ts"
);

// luna is NOT an ultra-capable alias model (only sol/terra are — see
// GPT_5_6_ULTRA_ALIAS_MODELS and src/shared/reasoning/effortStandardization.ts,
// which returns the native effort set WITHOUT "ultra" for luna). The hyphen form
// gpt-5.6-luna-ultra therefore correctly rejects ultra and passes the id through
// untouched (effort: null). The parenthesized form gpt-5.6-luna(ultra) MUST behave
// identically — the two spellings are semantically equivalent inputs. A divergence
// means luna(ultra) is silently accepted as a real ultra tier (wire effort "max")
// while luna-ultra is not, and the delegation-dependent detection
// (isCodexDelegationDependentModel) diverges between the two spellings too.
test("gpt-5.6-luna(ultra) is rejected exactly like gpt-5.6-luna-ultra (luna has no ultra tier)", () => {
  expect(GPT_5_6_ULTRA_ALIAS_MODELS.has("gpt-5.6-luna")).toBe(false);

  const hyphen = splitCodexReasoningSuffix("gpt-5.6-luna-ultra");
  const paren = splitCodexReasoningSuffix("gpt-5.6-luna(ultra)");

  // Hyphen form is the already-correct reference.
  expect(hyphen.effort).toBeNull();

  // The parenthesized form must NOT fabricate an ultra tier for luna.
  expect(paren.effort).toBeNull();
});

// Guard the capable models so the fix does not over-correct: sol/terra genuinely
// support ultra in BOTH spellings, and luna still supports max in both spellings.
test("ultra-capable aliases and luna(max) still resolve after the luna-ultra fix", () => {
  expect(splitCodexReasoningSuffix("gpt-5.6-sol-ultra")).toEqual({
    baseModel: "gpt-5.6-sol",
    effort: "ultra",
  });
  expect(splitCodexReasoningSuffix("gpt-5.6-sol(ultra)")).toEqual({
    baseModel: "gpt-5.6-sol",
    effort: "ultra",
  });
  expect(splitCodexReasoningSuffix("gpt-5.6-terra(ultra)")).toEqual({
    baseModel: "gpt-5.6-terra",
    effort: "ultra",
  });
  expect(splitCodexReasoningSuffix("gpt-5.6-luna-max")).toEqual({
    baseModel: "gpt-5.6-luna",
    effort: "max",
  });
  expect(splitCodexReasoningSuffix("gpt-5.6-luna(max)")).toEqual({
    baseModel: "gpt-5.6-luna",
    effort: "max",
  });
});

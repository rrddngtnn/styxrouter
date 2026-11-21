export const CODEX_EFFORT_ORDER = [
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
] as const;
export type CodexEffortLevel = (typeof CODEX_EFFORT_ORDER)[number];
export const GPT_5_6_MAX_ALIAS_MODELS = new Set(["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]);
export const GPT_5_6_ULTRA_ALIAS_MODELS = new Set(["gpt-5.6-sol", "gpt-5.6-terra"]);

export function splitCodexReasoningSuffix(model: unknown): {
  baseModel: string;
  effort: CodexEffortLevel | null;
} {
  const modelId = typeof model === "string" ? model : "";
  const terra61Match = /^(gpt-6\.1-terra)(?:-(max|ultra)|\((max|ultra)\))$/.exec(modelId);
  if (terra61Match) {
    return { baseModel: terra61Match[1], effort: (terra61Match[2] ?? terra61Match[3]) as CodexEffortLevel };
  }
  const gpt56Match = /^(gpt-5\.6-(?:sol|terra|luna))(?:-(max|ultra)|\((max|ultra)\))$/.exec(
    modelId
  );
  if (gpt56Match) {
    const [, baseModel, hyphenEffort, parenthesizedEffort] = gpt56Match;
    const effort = hyphenEffort ?? parenthesizedEffort;
    // The supported-model set is a function of the requested EFFORT, not of the
    // spelling (hyphen vs parenthesized): luna supports max but not ultra, so
    // both gpt-5.6-luna-ultra and gpt-5.6-luna(ultra) must be rejected identically.
    // Keying off `parenthesizedEffort` alone let the paren spelling fabricate an
    // ultra tier for luna that the hyphen spelling correctly refused.
    const supportedModels =
      effort === "ultra" ? GPT_5_6_ULTRA_ALIAS_MODELS : GPT_5_6_MAX_ALIAS_MODELS;
    if (supportedModels.has(baseModel)) {
      return { baseModel, effort: effort as CodexEffortLevel };
    }
  }

  for (const effort of ["none", "low", "medium", "high", "xhigh"] as const) {
    if (modelId.endsWith(`-${effort}`)) {
      return { baseModel: modelId.slice(0, -`-${effort}`.length), effort };
    }
  }
  return { baseModel: modelId, effort: null };
}

/**
 * Maximum reasoning effort allowed per Codex model.
 * Models not listed here retain the legacy xhigh cap.
 * Shared by both CodexExecutor clamping and catalog effort-tier advertisement so
 * the catalog never advertises a tier the executor clamps away.
 */
export const CODEX_MAX_EFFORT_BY_MODEL: Record<string, CodexEffortLevel> = {
  "gpt-6.1-terra": "ultra",
  "gpt-5.6-sol": "ultra",
  "gpt-5.6-terra": "ultra",
  "gpt-5.6-luna": "max",
  "gpt-5.3-codex": "xhigh",
  "gpt-5.1-codex-max": "xhigh",
  "gpt-5-mini": "high",
  "gpt-5.1-mini": "high",
  "gpt-4.1-mini": "high",
};

export function getCodexDefaultEffortTiers(model: string): CodexEffortLevel[] {
  const { baseModel } = splitCodexReasoningSuffix(model);
  const cap: CodexEffortLevel = CODEX_MAX_EFFORT_BY_MODEL[baseModel] ?? "xhigh";
  const maxIdx = CODEX_EFFORT_ORDER.indexOf(cap);
  const startIdx = baseModel === "gpt-6.1-terra" ? 0 : 1;
  return [...CODEX_EFFORT_ORDER.slice(startIdx, maxIdx + 1)];
}

export function filterCodexEffortTiers(
  model: string,
  efforts: readonly string[]
): CodexEffortLevel[] {
  const { baseModel } = splitCodexReasoningSuffix(model);
  const cap: CodexEffortLevel = CODEX_MAX_EFFORT_BY_MODEL[baseModel] ?? "xhigh";
  const maxIdx = CODEX_EFFORT_ORDER.indexOf(cap);
  const allowed = new Set<string>(CODEX_EFFORT_ORDER.slice(0, maxIdx + 1));
  const normalized = new Set<string>();
  for (const effort of efforts) {
    if (typeof effort !== "string") continue;
    const lowered = effort.trim().toLowerCase();
    if (allowed.has(lowered)) normalized.add(lowered);
  }
  return CODEX_EFFORT_ORDER.filter((level) => normalized.has(level));
}

export function isCodexReasoningBaseModel(model: string): boolean {
  if (!model || splitCodexReasoningSuffix(model).effort !== null) return false;
  if (Object.hasOwn(CODEX_MAX_EFFORT_BY_MODEL, model)) return true;
  return /^gpt-(?:5(?:\.\d+)?|6(?:\.\d+)?)(?:-|$)/i.test(model);
}

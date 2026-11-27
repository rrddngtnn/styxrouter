/** Pure output-default selection. Unknown capacity never authorizes a fallback. */
export function resolveGenerationBudget(policy: {
  explicit?: unknown;
  modelDefault?: unknown;
  supportedDefault?: unknown;
  fallback?: unknown;
  hardLimit?: unknown;
}): number | undefined {
  const positive = (value: unknown): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
  const limit = positive(policy.hardLimit) ? policy.hardLimit : undefined;
  // Invalid explicit values belong to request validation, not default repair.
  if (policy.explicit !== undefined) {
    return typeof policy.explicit === 'number'
      ? (limit === undefined ? policy.explicit : Math.min(policy.explicit, limit))
      : undefined;
  }
  if (limit === undefined) return undefined;
  const candidate = [policy.modelDefault, policy.supportedDefault, policy.fallback].find(positive);
  return candidate === undefined ? undefined : Math.min(candidate, limit);
}

export const isHydrogenTier = (model: string): boolean =>
  /^(?:antigravity\/)?gemini-4-hydrogen-(?:low|medium|high|xhigh)$/.test(model);

/** Deployment-neutral optional config: exact canonical model keys, no suffix inheritance. */
export function getGenerationBudgetDefaults(model: string): { modelDefault?: unknown; fallback?: unknown } {
  try {
    const config = JSON.parse(process.env.STYX_GENERATION_DEFAULTS || '{}');
    const key = model.startsWith('antigravity/') ? model : `antigravity/${model}`;
    return {
      modelDefault: config?.models && Object.hasOwn(config.models, key) ? config.models[key] : undefined,
      fallback: config?.fallbackMaxTokens,
    };
  } catch {
    return {};
  }
}

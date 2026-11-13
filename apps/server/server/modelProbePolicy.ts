/** Bounded management probe policy; ordinary caller budgets remain unchanged. */
export function getModelProbePolicy(model: string): { maxTokens: number; timeoutMs: number } {
  return /^antigravity\/gemini-4-hydrogen-(?:low|medium|high|xhigh)$/.test(model)
    ? { maxTokens: 32768, timeoutMs: 60_000 }
    : { maxTokens: 8, timeoutMs: 10_000 };
}

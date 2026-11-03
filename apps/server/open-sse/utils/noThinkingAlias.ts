/** Candidate replacement from the local routing/catalog contract.
 * Retains the public no-think/ API, not Free Claude's gateway encoding.
 * Prior source was inspected: this is not a clean-room provenance claim.
 */
import { getModelSpec } from "@/shared/constants/modelSpecs";
export const NO_THINKING_PREFIX = "no-think/";
export function isNoThinkingAlias(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(NO_THINKING_PREFIX);
}
export function stripNoThinkingAlias(value: string): string {
  return isNoThinkingAlias(value) ? value.substring(NO_THINKING_PREFIX.length) : value;
}
export function toNoThinkingAlias(value: string): string { return NO_THINKING_PREFIX + value; }
export function applyNoThinkingAlias(body: Record<string, unknown> | null | undefined, opts: { claudeFormat?: boolean } = {}): { applied: boolean; realModel?: string } {
  if (!body || !isNoThinkingAlias(body.model)) return { applied: false };
  const target = stripNoThinkingAlias(body.model);
  if (!target) return { applied: false };
  Object.assign(body, { model: target });
  delete body.reasoning;
  if (opts.claudeFormat) {
    delete body.reasoning_effort;
    body.thinking = { type: "disabled" };
  } else body.reasoning_effort = "none";
  return { applied: true, realModel: target };
}
type Entry = { id?: unknown; owned_by?: unknown; name?: unknown; [key: string]: unknown };
const modelName = (id: string) => id.split("/").at(-1)!;
export function shouldExposeNoThinkingAlias(model: Entry): boolean {
  if (!model || typeof model.id !== "string" || !model.id || model.owned_by === "combo") return false;
  if (isNoThinkingAlias(model.id) || /-(low|medium|high|xhigh)$/i.test(model.id)) return false;
  const name = modelName(model.id);
  const spec = getModelSpec(name);
  return !!spec && (spec.noThinkingAlias ?? (name.toLowerCase().includes("claude") && spec.supportsThinking === true && spec.rejectsThinkingDisabled !== true));
}
export function appendNoThinkingVariants<T extends Entry>(models: T[], aliasToCanonical?: Record<string, string>): T[] {
  const additions: T[] = [];
  for (const model of models) {
    if (!shouldExposeNoThinkingAlias(model)) continue;
    const parts = (model.id as string).split("/");
    if (parts.length > 1 && aliasToCanonical && Object.hasOwn(aliasToCanonical, parts[0])) parts[0] = aliasToCanonical[parts[0]] || parts[0];
    const id = parts.join("/");
    additions.push({ ...model, id: toNoThinkingAlias(id), root: toNoThinkingAlias(modelName(id)), ...(typeof model.name === "string" && model.name ? { name: `${model.name} (no thinking)` } : {}) });
  }
  return additions.length ? models.concat(additions) : models;
}

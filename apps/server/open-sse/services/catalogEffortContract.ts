/**
 * Unified catalog & alias effort contract across providers.
 *
 * Keeps canonical base models and compatibility aliases aligned with what each
 * provider executor actually dispatches:
 *
 * - Base models advertise selectable tiers (`capabilities.effort_tiers`) and
 *   `capabilities.effort_configurable = true` identically in expanded and compact
 *   catalog modes.
 * - Fixed effort aliases (e.g. `<provider>/<model>-high`) retain `reasoning: true`
 *   (and `thinking`/`supportsThinking: true`), omit `effort_tiers`, and explicitly
 *   mark `effort_configurable: false` plus `fixed_effort: "<tier>"`, so clients
 *   distinguish "reasoning available" from "effort selectable".
 * - Thinking-disabled aliases (`no-think/<id>` or `-none`) mark `reasoning: false`,
 *   `thinking: false`, `supportsThinking: false`, `effort_configurable: false`,
 *   `fixed_effort: "none"`, and omit `effort_tiers`.
 * - Literal model IDs always win on collision against synthetic or static aliases.
 */
import { getModelSpec } from "@/shared/constants/modelSpecs";
import { getRegistryEntry } from "../config/providerRegistry.ts";
import { supportsXHighEffort } from "../config/providerModels.ts";
import {
  getCodexDefaultEffortTiers,
  splitCodexReasoningSuffix,
} from "../executors/codex/reasoningSuffix.ts";
import { parseGlmEffortTier } from "../executors/glm.ts";
import {
  getOpencodeEffortTiers,
  parseEffortLevel as parseOpencodeEffortLevel,
} from "../executors/opencode.ts";

export const CATALOG_FIXED_EFFORT_ALIAS = Symbol("catalogFixedEffortAlias");
export const CATALOG_CODEX_NO_EFFORT_TIERS = Symbol("catalogCodexNoEffortTiers");

export type FixedEffortAliasMeta = {
  baseId: string;
  effort: string;
  disablesThinking: boolean;
};

export type StaticEffortAliasResolution = {
  baseModel: string;
  effort: string;
  disablesThinking: boolean;
};

type CatalogEntry = Record<string, unknown>;

const CLAUDE_NAME_RE = /claude/i;
const CLAUDE_BASE_EFFORT_LEVELS = ["low", "medium", "high"] as const;

export function buildFixedEffortAliasCapabilities(
  existingCapabilities: unknown,
  meta: FixedEffortAliasMeta
): Record<string, unknown> {
  const baseCaps =
    existingCapabilities && typeof existingCapabilities === "object" && !Array.isArray(existingCapabilities)
      ? { ...(existingCapabilities as Record<string, unknown>) }
      : {};
  delete baseCaps.effort_tiers;

  const reasoningEnabled = !meta.disablesThinking && meta.effort !== "none";
  return {
    ...baseCaps,
    reasoning: reasoningEnabled,
    thinking: reasoningEnabled,
    supportsThinking: reasoningEnabled,
    effort_configurable: false,
    fixed_effort: meta.effort,
  };
}

export function applyFixedEffortAliasCapabilities<T extends CatalogEntry>(
  model: T,
  meta: FixedEffortAliasMeta
): T {
  const next: CatalogEntry = {
    ...model,
    capabilities: buildFixedEffortAliasCapabilities(model.capabilities, meta),
  };
  Reflect.set(next, CATALOG_FIXED_EFFORT_ALIAS, meta);
  return next as T;
}

export function getFixedEffortAliasMeta(entry: CatalogEntry): FixedEffortAliasMeta | null {
  const marked = Reflect.get(entry, CATALOG_FIXED_EFFORT_ALIAS);
  if (marked && typeof marked === "object") {
    return marked as FixedEffortAliasMeta;
  }

  const id = typeof entry.id === "string" ? entry.id : "";
  if (id.startsWith("no-think/")) {
    return {
      baseId: id.slice("no-think/".length),
      effort: "none",
      disablesThinking: true,
    };
  }

  const caps =
    entry.capabilities && typeof entry.capabilities === "object" && !Array.isArray(entry.capabilities)
      ? (entry.capabilities as Record<string, unknown>)
      : null;
  if (caps?.effort_configurable === false && typeof caps.fixed_effort === "string" && caps.fixed_effort) {
    return {
      baseId: id,
      effort: caps.fixed_effort,
      disablesThinking: caps.fixed_effort === "none" || caps.reasoning === false,
    };
  }

  return null;
}

/**
 * Canonical selectable effort tiers for a Claude-family base model.
 * Aligns catalog capabilities with what Claude executors actually accept:
 * - omits `xhigh` when `supportsXHighEffort` is false;
 * - omits `none` when `rejectsThinkingDisabled` is true.
 */
export function getClaudeSelectableEffortTiers(
  providerId: string,
  bareModelId: string
): string[] | undefined {
  if (!bareModelId || !CLAUDE_NAME_RE.test(bareModelId)) return undefined;
  const spec = getModelSpec(bareModelId);
  if (spec?.supportsThinking !== true) return undefined;

  const tiers: string[] = [];
  if (spec.rejectsThinkingDisabled !== true) {
    tiers.push("none");
  }
  tiers.push(...CLAUDE_BASE_EFFORT_LEVELS);
  if (supportsXHighEffort(providerId, bareModelId)) {
    tiers.push("xhigh");
  }
  return tiers;
}

/**
 * Canonical selectable effort tiers for an OpenCode-family (`opencode`,
 * `opencode-go`, `opencode-zen`) base model, matching `OpencodeExecutor`'s
 * `EFFORT_TIERS` table.
 */
export function getOpencodeSelectableEffortTiers(
  providerId: string,
  bareModelId: string
): string[] | undefined {
  if (!providerId || !bareModelId) return undefined;
  const entry = getRegistryEntry(providerId);
  if (entry?.executor !== "opencode") return undefined;
  const tiers = getOpencodeEffortTiers(bareModelId);
  return tiers && tiers.length > 0 ? [...tiers] : undefined;
}

/**
 * Resolve a provider-owned static effort alias (Codex, GLM, OpenCode) back to its
 * canonical base model and locked effort level. Returns `null` when `modelId` is a
 * literal model ID in `literalIds`, or when the suffix is not actually supported/routed
 * by that provider's executor.
 */
export function resolveStaticCatalogEffortAlias(
  provider: string,
  modelId: string,
  opts?: {
    scopedTiers?: (base: string) => readonly string[] | undefined;
    literalIds?: ReadonlySet<string>;
  }
): StaticEffortAliasResolution | null {
  if (!provider || !modelId) return null;
  if (opts?.literalIds?.has(modelId)) return null;

  const entry = getRegistryEntry(provider);
  if (!entry) return null;

  if (entry.executor === "codex") {
    const { baseModel, effort } = splitCodexReasoningSuffix(modelId);
    if (!effort || baseModel === modelId) {
      const m = /^(.+)-(max|ultra)$/.exec(modelId);
      if (m && opts?.scopedTiers?.(m[1])?.includes(m[2])) {
        return { baseModel: m[1], effort: m[2], disablesThinking: false };
      }
      return null;
    }

    const defaultTiers = getCodexDefaultEffortTiers(baseModel);
    const allowedTiers = opts?.scopedTiers ? opts.scopedTiers(baseModel) : defaultTiers;
    const effortSupported =
      Boolean(allowedTiers && allowedTiers.includes(effort)) ||
      (effort === "none" && defaultTiers.includes("none"));
    if (!effortSupported) return null;

    return {
      baseModel,
      effort,
      disablesThinking: effort === "none",
    };
  }

  if (entry.executor === "glm") {
    const parsed = parseGlmEffortTier(modelId);
    if (!parsed) return null;
    return {
      baseModel: parsed.baseModel,
      effort: parsed.effort,
      disablesThinking: false,
    };
  }

  if (entry.executor === "opencode") {
    const parsed = parseOpencodeEffortLevel(modelId);
    if (!parsed) return null;
    return {
      baseModel: parsed.baseModel,
      effort: parsed.effort,
      disablesThinking: parsed.effort === "none",
    };
  }

  return null;
}

/**
 * Compact mode helper: drop only verified aliases whose canonical base model
 * survives in the same namespace.
 */
export function compactEffortAliases<T extends CatalogEntry>(
  rows: T[],
  resolveAlias: (row: T) => FixedEffortAliasMeta | null
): T[] {
  const chatIds = new Set(
    rows
      .filter((row) => row.owned_by !== "combo" && (!row.type || row.type === "chat"))
      .map((row) => row.id)
  );
  return rows.filter((row) => {
    if (row.owned_by === "combo" || (row.type && row.type !== "chat")) return true;
    const resolved = resolveAlias(row);
    return !resolved || !chatIds.has(resolved.baseId);
  });
}

/**
 * Expanded mode helper: mark verified static aliases (e.g. registered Codex or
 * GLM suffix entries) as fixed-effort aliases so they never inherit the base
 * model's selectable `effort_tiers` menu.
 */
export function markStaticEffortAliases<T extends CatalogEntry>(
  rows: T[],
  resolveAlias: (row: T) => FixedEffortAliasMeta | null
): T[] {
  const chatIds = new Set(
    rows
      .filter((row) => row.owned_by !== "combo" && (!row.type || row.type === "chat"))
      .map((row) => row.id)
  );
  let changed = false;
  const next = rows.map((row) => {
    if (row.owned_by === "combo" || (row.type && row.type !== "chat")) return row;
    const resolved = resolveAlias(row);
    if (!resolved || !chatIds.has(resolved.baseId)) return row;
    changed = true;
    return applyFixedEffortAliasCapabilities(row, resolved);
  });
  return changed ? next : rows;
}

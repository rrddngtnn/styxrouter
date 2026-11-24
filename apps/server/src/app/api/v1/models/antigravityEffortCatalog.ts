import { CANONICAL_EFFORT_VALUES } from "@/shared/reasoning/effortStandardization";
import type { EffortFamily } from "@/shared/reasoning/effortVariants";
import {
  formatCanonicalEffortLabel,
  formatProviderDisplayLabel,
  normalizeCatalogDisplayName,
  stripTrailingEffortLabel,
} from "@/lib/catalogDisplayName";
import { applyFixedEffortAliasCapabilities } from "@styxrouter/open-sse/services/catalogEffortContract.ts";
import {
  getAntigravityTieredAliasTarget,
  getStaticAntigravitySingleTierAlias,
} from "@styxrouter/open-sse/services/antigravityEffortFamily.ts";
import { intersectStringArrays, isPositiveFiniteNumber } from "./catalogHelpers";

export const ANTIGRAVITY_EFFORT_FAMILY = Symbol("antigravityEffortFamily");
export const ANTIGRAVITY_EFFORT_MEMBERS = Symbol("antigravityEffortMembers");

type Entry = Record<string, unknown>;

function deriveAntigravityFamilyDisplayName(
  baseRow: Record<string, unknown>,
  enrichedMembers: ReadonlyArray<Record<string, unknown>>
): string {
  const root =
    typeof baseRow.root === "string" && baseRow.root.trim()
      ? baseRow.root.trim()
      : typeof baseRow.id === "string"
        ? baseRow.id.split("/").pop() || baseRow.id
        : "";
  const ownedBy = typeof baseRow.owned_by === "string" ? baseRow.owned_by : undefined;
  const baseCaps =
    baseRow.capabilities && typeof baseRow.capabilities === "object"
      ? (baseRow.capabilities as Record<string, unknown>)
      : {};
  const fixedEffort = typeof baseCaps.fixed_effort === "string" ? baseCaps.fixed_effort : null;

  const explicitName =
    typeof baseRow.name === "string" && baseRow.name.trim() && baseRow.name.trim() !== root
      ? baseRow.name.trim()
      : null;

  let memberCandidate: string | null = null;
  if (!explicitName) {
    const providerLabel = formatProviderDisplayLabel(ownedBy);
    for (const member of enrichedMembers) {
      if (typeof member.name !== "string" || !member.name.trim()) continue;
      const memberRoot = typeof member.root === "string" ? member.root.trim() : "";
      if (memberRoot && member.name.trim() === memberRoot) continue;
      let stripped = member.name.trim();
      if (providerLabel) {
        stripped = stripped
          .replace(
            new RegExp(`\\s*\\(\\s*${providerLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\)\\s*$`, "i"),
            ""
          )
          .trim();
      }
      stripped = stripTrailingEffortLabel(stripped);
      const memberCaps =
        member.capabilities && typeof member.capabilities === "object"
          ? (member.capabilities as Record<string, unknown>)
          : {};
      const memberEffort =
        typeof memberCaps.fixed_effort === "string"
          ? memberCaps.fixed_effort
          : (memberRoot.match(/-(none|low|medium|high|xhigh|max|ultra)$/i)?.[1]?.toLowerCase() ??
            fixedEffort);
      if (memberEffort) {
        const tierWord = formatCanonicalEffortLabel(memberEffort);
        if (tierWord) {
          stripped = stripped.replace(new RegExp(`\\s+${tierWord}$`, "i"), "").trim();
        }
      } else {
        stripped = stripped.replace(/\s+(?:None|Low|Medium|High|XHigh|Max|Ultra)$/i, "").trim();
      }
      if (stripped && stripped !== root) {
        memberCandidate = stripped;
        break;
      }
    }
  }

  return normalizeCatalogDisplayName(explicitName || memberCandidate, {
    modelId: root,
    provider: ownedBy,
    fixedEffort,
    appendEffortLabel: false,
    stripEffortLabel: true,
  });
}

export function projectAntigravityFamilyMetadata(
  baseRow: Record<string, unknown>,
  enrichedMembers: ReadonlyArray<Record<string, unknown>>
): Record<string, unknown> {
  const baseCaps =
    baseRow.capabilities && typeof baseRow.capabilities === "object"
      ? (baseRow.capabilities as Record<string, unknown>)
      : {};
  const tiers = Array.isArray(baseCaps.effort_tiers) ? baseCaps.effort_tiers : [];
  const fixedEffort = typeof baseCaps.fixed_effort === "string" ? baseCaps.fixed_effort : undefined;
  const displayName = deriveAntigravityFamilyDisplayName(baseRow, enrichedMembers);
  if (enrichedMembers.length === 0) {
    return {
      ...baseRow,
      name: displayName,
      capabilities: {
        ...baseCaps,
        reasoning: true,
        thinking: true,
        supportsThinking: true,
        effort_configurable: tiers.length > 0 && !fixedEffort,
        ...(tiers.length > 0 && !fixedEffort ? { effort_tiers: tiers } : {}),
        ...(fixedEffort ? { fixed_effort: fixedEffort } : {}),
      },
    };
  }

  const memberCaps = enrichedMembers.map((member) =>
    member.capabilities && typeof member.capabilities === "object"
      ? (member.capabilities as Record<string, unknown>)
      : {}
  );
  const allToolCalling = memberCaps.every((caps) => caps.tool_calling === true);
  const allVision = memberCaps.every((caps) => caps.vision === true);
  const allBooleanVision = memberCaps.every((caps) => typeof caps.vision === "boolean");

  const minAllPositive = (key: string): number | undefined => {
    const values: number[] = [];
    for (const member of enrichedMembers) {
      const value = member[key];
      if (!isPositiveFiniteNumber(value)) return undefined;
      values.push(value);
    }
    return values.length > 0 ? Math.min(...values) : undefined;
  };

  const intersectAllModalities = (key: string): string[] | undefined => {
    const lists: string[][] = [];
    for (const member of enrichedMembers) {
      const raw = member[key];
      if (!Array.isArray(raw)) return undefined;
      const values = raw.filter(
        (item): item is string => typeof item === "string" && item.length > 0
      );
      if (values.length === 0) return undefined;
      lists.push(values);
    }
    const common = intersectStringArrays(lists);
    return common.length > 0 ? common : undefined;
  };

  const contextLength = minAllPositive("context_length");
  const maxInputTokens = minAllPositive("max_input_tokens");
  const maxOutputTokens = minAllPositive("max_output_tokens");
  const inputModalities = intersectAllModalities("input_modalities");
  const outputModalities = intersectAllModalities("output_modalities");

  return {
    ...baseRow,
    name: displayName,
    ...(contextLength !== undefined ? { context_length: contextLength } : {}),
    ...(maxInputTokens !== undefined ? { max_input_tokens: maxInputTokens } : {}),
    ...(maxOutputTokens !== undefined ? { max_output_tokens: maxOutputTokens } : {}),
    ...(inputModalities ? { input_modalities: inputModalities } : {}),
    ...(outputModalities ? { output_modalities: outputModalities } : {}),
    capabilities: {
      ...baseCaps,
      reasoning: true,
      thinking: true,
      supportsThinking: true,
      effort_configurable: tiers.length > 0 && !fixedEffort,
      ...(tiers.length > 0 && !fixedEffort ? { effort_tiers: tiers } : {}),
      ...(fixedEffort ? { fixed_effort: fixedEffort } : {}),
      tool_calling: allToolCalling,
      ...(allVision ? { vision: true } : allBooleanVision ? { vision: false } : {}),
    },
  };
}

/**
 * Project declared Antigravity effort families identically across BOTH compact
 * and expanded modes:
 * - Both modes expose the canonical base family row with identical `effort_tiers`
 *   and `effort_configurable: true`.
 * - Compact mode omits member wire rows (`-low`, `-medium`, `-high`), redundant
 *   `-tiered` alias targets/sub-families already covered by the base family, and
 *   static single-tier suffixed wire rows whose canonical base alias is emitted.
 * - Expanded mode retains member wire rows as fixed-effort aliases
 *   (`reasoning: true`, `effort_configurable: false`, `fixed_effort: "<tier>"`,
 *   without `effort_tiers`).
 */
export async function applyDeclaredEffortFamilies(
  rows: Array<Record<string, any>>,
  loadFamilies: (provider: string) => Promise<Map<string, EffortFamily> | undefined>,
  isAllowed: (
    provider: string,
    publicId: string,
    modelId: string,
    isWire: boolean
  ) => Promise<boolean>,
  compact: boolean,
  allowedConnections?: readonly string[]
): Promise<Array<Record<string, any>>> {
  const namespaces = new Map<string, Map<string, Entry & { id: string }>>();
  const ids = new Set(rows.map((row) => row.id));
  for (const row of rows) {
    if (
      row.owned_by === "combo" ||
      (row.type && row.type !== "chat") ||
      typeof row.id !== "string" ||
      typeof row.root !== "string" ||
      typeof row.owned_by !== "string" ||
      !row.id.endsWith(`/${row.root}`)
    ) {
      continue;
    }
    const prefix = row.id.slice(0, -row.root.length);
    if (prefix.indexOf("/") !== prefix.length - 1) continue;
    const key = `${row.owned_by}\0${prefix}`;
    let entries = namespaces.get(key);
    if (!entries) namespaces.set(key, (entries = new Map()));
    entries.set(row.root, row as Entry & { id: string });
  }

  const removed = new Set<Entry>();
  const replacements = new Map<Entry, Entry>();
  const added: Entry[] = [];
  const inventories = new Map<string, Awaited<ReturnType<typeof loadFamilies>>>();

  for (const [scope, entries] of namespaces) {
    const [provider, prefix] = scope.split("\0");
    if (!inventories.has(provider)) inventories.set(provider, await loadFamilies(provider));
    const families = inventories.get(provider);
    const claimedMembers = new Set<Entry>();

    type PlannedFamily = {
      id: string;
      base: string;
      existing: (Entry & { id: string }) | undefined;
      memberEntries: Array<{ row: Entry; effort: string }>;
      tiers: string[];
      family: EffortFamily;
    };
    const plannedFamilies = new Map<string, PlannedFamily>();

    if (families) {
      for (const [base, family] of families) {
        const id = prefix + base;
        const existing = entries.get(base);
        if ((ids.has(id) && !existing) || !(await isAllowed(provider, id, base, false))) continue;

        const memberEntries: Array<{ row: Entry; effort: string }> = [];
        const tiers: string[] = [];
        for (const effort of CANONICAL_EFFORT_VALUES) {
          const route = family.tiers.get(effort);
          const row = route && entries.get(route.wireId);
          if (!route || !row) continue;
          if (
            !(await isAllowed(provider, row.id, route.wireId, true)) ||
            (allowedConnections?.length &&
              !allowedConnections.some((connId) => route.connectionIds.has(connId)))
          ) {
            removed.add(row);
            continue;
          }
          memberEntries.push({ row, effort });
          tiers.push(effort);
        }
        if (!memberEntries.length) continue;

        plannedFamilies.set(base, { id, base, existing, memberEntries, tiers, family });
      }
    }

    const survivingBases = new Set<string>();
    for (const [base, planned] of plannedFamilies) {
      const { id, existing, memberEntries, tiers, family } = planned;

      // In compact mode, omit a redundant `<parent>-tiered` family when `<parent>`
      // already survives in the same scope and covers all of its tiers.
      if (compact && base.endsWith("-tiered")) {
        const parentBase = base.slice(0, -"-tiered".length);
        const parent = plannedFamilies.get(parentBase);
        if (parent && tiers.every((tier) => parent.tiers.includes(tier))) {
          if (existing) removed.add(existing);
          for (const { row } of memberEntries) {
            removed.add(row);
            claimedMembers.add(row);
          }
          continue;
        }
      }

      survivingBases.add(base);
      const members = memberEntries.map((m) => m.row);
      const { object, created, owned_by, permission } = members[0];
      const existingName =
        existing && typeof existing.name === "string" && existing.name.trim() && existing.name.trim() !== base
          ? existing.name.trim()
          : undefined;
      const baseFamilyRow: Entry = {
        id,
        root: base,
        object,
        created,
        owned_by,
        permission,
        parent: null,
        type: "chat",
        ...(existingName ? { name: existingName } : {}),
        capabilities: {
          reasoning: true,
          thinking: true,
          supportsThinking: true,
          effort_configurable: true,
          effort_tiers: tiers,
        },
        ...(family.defaultEffort && tiers.includes(family.defaultEffort)
          ? { default_reasoning_effort: family.defaultEffort }
          : {}),
      };
      Reflect.set(baseFamilyRow, ANTIGRAVITY_EFFORT_FAMILY, true);
      Reflect.set(baseFamilyRow, ANTIGRAVITY_EFFORT_MEMBERS, members);

      if (existing) {
        replacements.set(existing, baseFamilyRow);
      } else {
        added.push(baseFamilyRow);
      }
      ids.add(id);

      for (const { row } of memberEntries) claimedMembers.add(row);
      if (compact) {
        for (const { row } of memberEntries) removed.add(row);
      } else {
        for (const { row, effort } of memberEntries) {
          replacements.set(
            row,
            applyFixedEffortAliasCapabilities(row, {
              baseId: id,
              effort,
              disablesThinking: effort === "none",
            })
          );
        }
      }
    }

    // Handle static `-tiered` alias targets (e.g. `gemini-3.8-flash-tiered`,
    // `gemini-3.7-flash-tiered`) whose base family survives in the same scope.
    for (const base of survivingBases) {
      const tieredTarget = getAntigravityTieredAliasTarget(base);
      if (!tieredTarget) continue;
      const tieredRow = entries.get(tieredTarget);
      if (!tieredRow || claimedMembers.has(tieredRow) || removed.has(tieredRow)) continue;
      if (compact) {
        removed.add(tieredRow);
      } else {
        const prevCaps =
          tieredRow.capabilities && typeof tieredRow.capabilities === "object"
            ? { ...(tieredRow.capabilities as Record<string, unknown>) }
            : {};
        delete prevCaps.effort_tiers;
        replacements.set(tieredRow, {
          ...tieredRow,
          capabilities: {
            ...prevCaps,
            reasoning: true,
            thinking: true,
            supportsThinking: true,
            effort_configurable: false,
          },
        });
      }
    }

    // Handle explicit static single-tier aliases (e.g. `gpt-oss-120b` -> `gpt-oss-120b-medium`)
    // so compact mode emits the canonical un-suffixed base ID without fabricating effort tiers.
    for (const [root, row] of entries) {
      if (claimedMembers.has(row) || removed.has(row) || replacements.has(row)) continue;
      const singleAlias = getStaticAntigravitySingleTierAlias(root);
      if (!singleAlias) continue;
      const baseId = prefix + singleAlias.baseModel;
      const existing = entries.get(singleAlias.baseModel);
      if (
        (ids.has(baseId) && !existing) ||
        !(await isAllowed(provider, baseId, singleAlias.baseModel, false)) ||
        !(await isAllowed(provider, row.id, root, true))
      ) {
        continue;
      }

      const { object, created, owned_by, permission } = row;
      const existingName =
        existing &&
        typeof existing.name === "string" &&
        existing.name.trim() &&
        existing.name.trim() !== singleAlias.baseModel
          ? existing.name.trim()
          : undefined;
      const baseRow: Entry = {
        id: baseId,
        root: singleAlias.baseModel,
        object,
        created,
        owned_by,
        permission,
        parent: null,
        type: "chat",
        ...(existingName ? { name: existingName } : {}),
        capabilities: {
          reasoning: true,
          thinking: true,
          supportsThinking: true,
          effort_configurable: false,
          fixed_effort: singleAlias.effort,
        },
      };
      Reflect.set(baseRow, ANTIGRAVITY_EFFORT_FAMILY, true);
      Reflect.set(baseRow, ANTIGRAVITY_EFFORT_MEMBERS, [row]);

      if (existing) {
        replacements.set(existing, baseRow);
      } else {
        added.push(baseRow);
      }
      ids.add(baseId);

      if (compact) {
        removed.add(row);
      } else {
        replacements.set(
          row,
          applyFixedEffortAliasCapabilities(row, {
            baseId,
            effort: singleAlias.effort,
            disablesThinking: false,
          })
        );
      }
    }
  }

  return [
    ...rows
      .filter((row) => !removed.has(row))
      .map((row) => replacements.get(row) ?? row),
    ...added,
  ];
}

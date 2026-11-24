import { createLazyConnectionView } from "@/lib/db/providers/lazyConnectionView";
import { getRawProviderConnections } from "@/lib/db/providers";
import { getSyncedAvailableModelsByConnection } from "@/lib/db/models";
import { getMitmAlias } from "@/lib/db/models/mitmAlias";
import { isModelExcludedByConnection } from "@/domain/connectionModelRules";
import { normalizeEffort, type CanonicalEffort } from "@/shared/reasoning/effortStandardization";
import {
  collectEffortFamilies,
  normalizeEffortVariant,
  type EffortFamily,
  type EffortVariant,
} from "@/shared/reasoning/effortVariants";
import {
  ANTIGRAVITY_MODEL_ALIASES,
  ANTIGRAVITY_PUBLIC_MODELS,
} from "../config/antigravityModelAliases.ts";

const STATIC_TIER_SUFFIXES = ["low", "medium", "high", "xhigh"] as const;

type StaticEffortFamilySpec = {
  tiers: Map<CanonicalEffort, string>;
  defaultEffort?: CanonicalEffort;
};

function buildStaticAntigravityEffortFamilies(): Map<string, StaticEffortFamilySpec> {
  const grouped = new Map<string, Map<CanonicalEffort, string>>();
  const publicIds = new Set(ANTIGRAVITY_PUBLIC_MODELS.map((entry) => entry.id));
  const claimedWireIds = new Set<string>();
  for (const entry of ANTIGRAVITY_PUBLIC_MODELS) {
    for (const effort of STATIC_TIER_SUFFIXES) {
      const token = `-${effort}`;
      if (!entry.id.endsWith(token) || entry.id.length <= token.length) continue;
      const base = entry.id.slice(0, -token.length);
      let tiers = grouped.get(base);
      if (!tiers) grouped.set(base, (tiers = new Map()));
      tiers.set(effort, entry.id);
      claimedWireIds.add(entry.id);
      break;
    }
  }
  const staticAliases = ANTIGRAVITY_MODEL_ALIASES as Record<string, string>;
  // Link static alias-mapped tiers (e.g. `gemini-3.1-pro-high` -> `gemini-pro-agent`)
  // into a family that already has a public tier (`gemini-3.1-pro-low`).
  for (const [aliasKey, targetWireId] of Object.entries(staticAliases)) {
    if (!publicIds.has(targetWireId) || claimedWireIds.has(targetWireId)) continue;
    for (const effort of STATIC_TIER_SUFFIXES) {
      const token = `-${effort}`;
      if (!aliasKey.endsWith(token) || aliasKey.length <= token.length) continue;
      const base = aliasKey.slice(0, -token.length);
      const tiers = grouped.get(base);
      if (!tiers || tiers.has(effort)) break;
      tiers.set(effort, targetWireId);
      claimedWireIds.add(targetWireId);
      break;
    }
  }
  const families = new Map<string, StaticEffortFamilySpec>();
  for (const [base, tiers] of grouped) {
    if (tiers.size < 2) continue;
    let defaultEffort: CanonicalEffort | undefined;
    if (Object.hasOwn(staticAliases, base)) {
      const target = staticAliases[base];
      for (const [effort, wireId] of tiers) {
        if (wireId === target) {
          defaultEffort = effort;
          break;
        }
      }
    } else if (tiers.has("medium")) {
      defaultEffort = "medium";
    } else if (tiers.has("high")) {
      defaultEffort = "high";
    }
    families.set(base, { tiers, ...(defaultEffort ? { defaultEffort } : {}) });
  }
  return families;
}

const STATIC_ANTIGRAVITY_EFFORT_FAMILIES = buildStaticAntigravityEffortFamilies();

function buildStaticAntigravitySingleTierAliases(): Map<
  string,
  { baseModel: string; effort: CanonicalEffort }
> {
  const map = new Map<string, { baseModel: string; effort: CanonicalEffort }>();
  const staticAliases = ANTIGRAVITY_MODEL_ALIASES as Record<string, string>;
  for (const [baseModel, wireId] of Object.entries(staticAliases)) {
    if (STATIC_ANTIGRAVITY_EFFORT_FAMILIES.has(baseModel)) continue;
    if (baseModel.endsWith("-thinking")) continue;
    for (const effort of STATIC_TIER_SUFFIXES) {
      if (wireId === `${baseModel}-${effort}`) {
        map.set(wireId, { baseModel, effort });
        break;
      }
    }
  }
  return map;
}

const STATIC_ANTIGRAVITY_SINGLE_TIER_ALIASES = buildStaticAntigravitySingleTierAliases();

export function getStaticAntigravitySingleTierAlias(
  wireId: string
): { baseModel: string; effort: CanonicalEffort } | null {
  return STATIC_ANTIGRAVITY_SINGLE_TIER_ALIASES.get(wireId) ?? null;
}

export function getAntigravityTieredAliasTarget(baseModel: string): string | null {
  const staticAliases = ANTIGRAVITY_MODEL_ALIASES as Record<string, string>;
  if (!Object.hasOwn(staticAliases, baseModel)) return null;
  const target = staticAliases[baseModel];
  return typeof target === "string" && target.endsWith("-tiered") ? target : null;
}

// Antigravity's catalog records the native level on each exact wire row.
// Require corroborating rows at distinct native levels before accepting the
// adapter's suffix convention; a suffix alone is never family evidence.
const NATIVE_LEVELS: Record<number, string> = { 1: "low", 2: "medium", 3: "high", 100: "xhigh" };

export function readAntigravityEffortVariants(
  rows: ReadonlyArray<{ id: string; effortVariant?: unknown; thinkingLevel?: unknown }>,
  defaultAgentModelId: unknown
): Map<string, EffortVariant> {
  const inferred = new Map<string, Array<[string, EffortVariant]>>();
  const explicit = new Map<string, EffortVariant>();
  const explicitBases = new Set<string>();
  for (const row of rows) {
    const declaration = normalizeEffortVariant(row.effortVariant, row.id);
    if (declaration) {
      explicit.set(row.id, declaration);
      explicitBases.add(declaration.baseModel);
      continue;
    }
    if (row.effortVariant !== undefined || typeof row.thinkingLevel !== "number") continue;
    const effort = NATIVE_LEVELS[row.thinkingLevel];
    if (!effort || !row.id.endsWith(`-${effort}`)) continue;
    const baseModel = row.id.slice(0, -(effort.length + 1));
    const variant = normalizeEffortVariant(
      { baseModel, effort, default: row.id === defaultAgentModelId },
      row.id
    );
    if (!variant) continue;
    const members = inferred.get(baseModel) ?? [];
    members.push([row.id, variant]);
    inferred.set(baseModel, members);
  }
  for (const [base, members] of inferred) {
    if (
      !explicitBases.has(base) &&
      new Set(members.map(([, variant]) => variant.effort)).size >= 2
    ) {
      for (const [id, variant] of members) explicit.set(id, variant);
    }
  }
  return explicit;
}

export const antigravityEffortWireAclId = (
  model: string,
  provider?: string,
  requestedModel?: string
) => `${requestedModel?.startsWith("agy/") || provider === "agy" ? "agy" : "antigravity"}/${model}`;

export const supportsExactEffortFamily = (provider: string) =>
  provider === "antigravity" || provider === "agy";

async function readAntigravityMitmAliases(): Promise<Record<string, string>> {
  try {
    const aliases = await getMitmAlias("antigravity");
    return aliases && typeof aliases === "object" ? (aliases as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function hasAntigravityMitmAlias(aliases: Record<string, string>, model: string): boolean {
  const raw = aliases[model];
  return typeof raw === "string" && raw.length > 0 && raw !== model;
}

export type AntigravityCatalogScope = {
  families: Map<string, EffortFamily>;
  unauthorizedOnlyModelIds: Set<string>;
};

export async function loadAntigravityCatalogScope(
  provider: string,
  allowedConnectionIds?: ReadonlySet<string> | null
): Promise<AntigravityCatalogScope> {
  const providers = provider === "agy" ? ["agy", "antigravity"] : ["antigravity", "agy"];
  const accountData = new Map<string, unknown>();
  const permittedRows: Array<
    readonly [string, ReadonlyArray<{ id: string; effortVariant?: EffortVariant }>]
  > = [];
  const permittedRowIdSets = new Map<string, Set<string>>();
  const syncedLiteralIds = new Set<string>();
  const permittedModelIds = new Set<string>();
  const unauthorizedModelIds = new Set<string>();

  const [mitmAliases, providerSnapshots] = await Promise.all([
    readAntigravityMitmAliases(),
    Promise.all(
      providers.map(async (id) => {
        const [connections, inventory] = await Promise.all([
          getRawProviderConnections(
            { provider: id, isActive: true },
            undefined,
            undefined,
            ["id", "provider", "provider_specific_data"]
          ),
          getSyncedAvailableModelsByConnection(id),
        ]);
        return { connections, inventory };
      })
    ),
  ]);

  for (const { connections, inventory } of providerSnapshots) {
    for (const connection of connections) {
      const { id: connectionId, providerSpecificData } = createLazyConnectionView(connection);
      const rows = inventory[connectionId] ?? [];
      if (allowedConnectionIds && !allowedConnectionIds.has(connectionId)) {
        for (const row of rows) unauthorizedModelIds.add(row.id);
        continue;
      }
      accountData.set(connectionId, providerSpecificData);
      permittedRows.push([connectionId, rows] as const);
      const rowIds = new Set<string>();
      for (const row of rows) {
        rowIds.add(row.id);
        syncedLiteralIds.add(row.id);
      }
      permittedRowIdSets.set(connectionId, rowIds);
      if (rows.length === 0) {
        for (const pub of ANTIGRAVITY_PUBLIC_MODELS) {
          if (!isModelExcludedByConnection(pub.id, providerSpecificData)) {
            permittedModelIds.add(pub.id);
          }
        }
      } else {
        for (const row of rows) permittedModelIds.add(row.id);
      }
    }
  }

  const families = collectEffortFamilies(permittedRows, (id, row) => {
    const data = accountData.get(id);
    return (
      !isModelExcludedByConnection(row.effortVariant?.baseModel, data) &&
      !isModelExcludedByConnection(row.id, data)
    );
  });

  const staticAliases = ANTIGRAVITY_MODEL_ALIASES as Record<string, string>;
  for (const [base, family] of families) {
    if (hasAntigravityMitmAlias(mitmAliases, base)) {
      families.delete(base);
      continue;
    }
    if (Object.hasOwn(staticAliases, base)) {
      const staticTarget = staticAliases[base];
      let matchedTier: EffortFamily["defaultEffort"];
      for (const [effort, route] of family.tiers) {
        if (route.wireId === staticTarget) {
          matchedTier = effort;
          break;
        }
      }
      family.defaultEffort = matchedTier;
    }
  }

  // Fallback to provider-owned static Antigravity families whenever synced rows
  // do not override them (e.g. unsynced accounts or static ANTIGRAVITY_PUBLIC_MODELS).
  if (permittedRows.length > 0) {
    for (const [base, spec] of STATIC_ANTIGRAVITY_EFFORT_FAMILIES) {
      if (
        families.has(base) ||
        syncedLiteralIds.has(base) ||
        hasAntigravityMitmAlias(mitmAliases, base)
      ) {
        continue;
      }
      const tiers: EffortFamily["tiers"] = new Map();
      for (const [effort, wireId] of spec.tiers) {
        const connectionIds = new Set<string>();
        for (const [connectionId, rows] of permittedRows) {
          const data = accountData.get(connectionId);
          if (
            isModelExcludedByConnection(base, data) ||
            isModelExcludedByConnection(wireId, data)
          ) {
            continue;
          }
          if (rows.length === 0 || permittedRowIdSets.get(connectionId)?.has(wireId)) {
            connectionIds.add(connectionId);
          }
        }
        if (connectionIds.size > 0) tiers.set(effort, { wireId, connectionIds });
      }
      if (tiers.size > 0) {
        families.set(base, {
          tiers,
          ...(spec.defaultEffort && tiers.has(spec.defaultEffort)
            ? { defaultEffort: spec.defaultEffort }
            : {}),
          conflicts: new Set(),
        });
      }
    }
  }

  const unauthorizedOnlyModelIds = new Set<string>();
  for (const id of unauthorizedModelIds) {
    if (!permittedModelIds.has(id)) unauthorizedOnlyModelIds.add(id);
  }
  return { families, unauthorizedOnlyModelIds };
}

export async function loadAntigravityEffortFamilies(
  provider: string,
  allowedConnectionIds?: ReadonlySet<string> | null
) {
  if (allowedConnectionIds && allowedConnectionIds.size === 0) return new Map<string, EffortFamily>();
  return (await loadAntigravityCatalogScope(provider, allowedConnectionIds)).families;
}

function requestedFamilyEffort(body: Record<string, unknown>, endpoint?: string) {
  const nested = (body.reasoning as { effort?: unknown } | undefined)?.effort;
  const flat = body.reasoning_effort;
  const canonical = body.effort;
  const raw = endpoint?.split("/").includes("responses")
    ? nested ?? flat ?? canonical
    : flat ?? nested ?? canonical;
  return { explicit: raw !== undefined, effort: normalizeEffort(raw) };
}

export function isDeferredAntigravityStaticAlias(
  provider: string,
  model: string,
  body: Record<string, unknown>,
  endpoint?: string,
  forcedEffort?: string | null
): boolean {
  if (!supportsExactEffortFamily(provider)) return false;
  if (forcedEffort) return false;
  if (!Object.hasOwn(ANTIGRAVITY_MODEL_ALIASES, model)) return false;
  return !requestedFamilyEffort(body, endpoint).explicit;
}

export async function resolveExactEffortRoute(
  provider: string,
  model: string,
  body: Record<string, unknown>,
  endpoint?: string,
  forcedEffort?: string | null,
  allowedConnectionIds?: ReadonlySet<string> | null
) {
  if (!supportsExactEffortFamily(provider)) return null;
  if (isDeferredAntigravityStaticAlias(provider, model, body, endpoint, forcedEffort)) {
    return null;
  }
  const family = (await loadAntigravityEffortFamilies(provider, allowedConnectionIds)).get(model);
  if (!family) return null;
  const requested = requestedFamilyEffort(body, endpoint);
  const effort = forcedEffort
    ? normalizeEffort(forcedEffort)
    : requested.explicit
      ? requested.effort
      : family.defaultEffort;
  const route = effort ? family.tiers.get(effort) : undefined;
  return route && effort ? { ...route, effort } : false;
}

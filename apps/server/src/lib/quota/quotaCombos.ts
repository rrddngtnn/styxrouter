/**
 * quota/quotaCombos.ts — Auto-mint / prune `quotaShared-*` virtual combo models
 * when a quota pool gains or loses allocations (Phase B2).
 *
 * Each combo routes to a single {provider, model} target and is pinned to the
 * pool's connectionId via ComboModelStep.connectionId (supported by the combo
 * target schema). Phase B4 wires resolution — this module only keeps the combo
 * rows in sync with the pool's provider model list.
 *
 * Guard: combo-sync failures never propagate to pool CRUD callers.
 */

import { getPool, listPools } from "@/lib/db/quotaPools";
import { getGroupName } from "@/lib/db/quotaGroups";
import { getDbInstance } from "@/lib/db/core";
import { REGISTRY } from "@styxrouter/open-sse/config/providerRegistry";
import {
  quotaModelName,
  parseQuotaModelName,
  isQuotaModelName,
  quotaGroupSlug,
} from "./quotaModelNaming";
import type { AnyRoutingStrategyValue } from "@/shared/constants/routingStrategies";

/**
 * Routing strategy for every auto-minted quota-share (qtSd/) combo. Internal
 * only — resolves to the dedicated DRR + P2C in-flight + per-model gating
 * selection in combo.ts (Phase 3 #9). Was "fill-first" before the hardening.
 */
export const QUOTA_SHARE_STRATEGY: AnyRoutingStrategyValue = "quota-share";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the pool record for combo-sync purposes.
 * Returns null when the pool cannot be found.
 * Individual connection lookups are deferred to syncQuotaCombos so that a
 * single missing connection does not abort the whole sync.
 *
 * B4: also resolves the GROUP NAME so that combos are named
 * `qtSd/<groupSlug>/...` instead of `qtSd/<poolSlug>/...`.
 * Falls back to pool.name when the group record is missing.
 */
export async function resolvePoolForSync(poolId: string): Promise<{
  pool: {
    id: string;
    connectionId: string;
    connectionIds: string[];
    name: string;
    groupId: string;
    groupName: string;
  };
} | null> {
  const pool = getPool(poolId);
  if (!pool) return null;

  // Defensive: ensure connectionIds is always a non-empty array.
  const connectionIds: string[] =
    Array.isArray(pool.connectionIds) && pool.connectionIds.length > 0
      ? pool.connectionIds
      : [pool.connectionId];

  // B4: resolve the group name for combo naming.
  // Fall back to pool.name when the group is missing (legacy / test isolation).
  const groupName = getGroupName(pool.groupId) ?? pool.name;

  return {
    pool: {
      id: pool.id,
      connectionId: pool.connectionId,
      connectionIds,
      name: pool.name,
      groupId: pool.groupId,
      groupName,
    },
  };
}

/**
 * Return the list of model IDs for a provider from the provider REGISTRY — the
 * SAME source `/v1/models` uses. PROVIDER_MODELS only covers plain API providers
 * and is empty for CLI/OAuth providers (codex, kimi, claude, …), which silently
 * produced ZERO quotaShared-* combos. REGISTRY has all of them.
 * Empty array when the provider is unknown or has no registered models.
 */
function getProviderModelIds(provider: string): string[] {
  const entry = REGISTRY[provider as keyof typeof REGISTRY] as { models?: unknown } | undefined;
  const models = entry && Array.isArray(entry.models) ? entry.models : [];
  if (models.length === 0) return [];
  return models
    .map((m) =>
      typeof m === "object" && m !== null && typeof (m as { id?: unknown }).id === "string"
        ? (m as { id: string }).id
        : null
    )
    .filter((id): id is string => id !== null && id.length > 0);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Reconcile all managed qtSd/ names from authoritative pool membership and
 * provider metadata. The pool ID remains a caller/diagnostic hint; a deleted
 * pool still triggers orphan cleanup. Shared slugs merge their connections.
 * Preparation failures abort before writes; source mutations reject and retry
 * the entire batch. CRUD hooks handle failures without rolling back pool CRUD.
 */
export async function syncQuotaCombos(poolId: string): Promise<void> {
  const { applyQuotaComboReconciliation, listQuotaComboNames } = await import("@/lib/db/quotaComboReconciliation");
  const { getQuotaComboGeneration } = await import("@/lib/db/quotaComboGeneration");

  // Rebuild the complete managed projection, including orphan names left by
  // deletes, group moves/renames, and provider changes. A pool may already be gone.
  // The generation is read BEFORE source data and checked under the write lock.
  for (let attempt = 0; attempt < 32; attempt++) {
    const generation = getQuotaComboGeneration();
    const desired = new Map<string, {
      name: string;
      models: Array<{ kind: "model"; model: string; providerId: string; connectionId: string; weight: number }>;
      strategy: string;
      isHidden: true;
    }>();
    const seen = new Map<string, Set<string>>();
    const providerFor = getDbInstance().prepare("SELECT provider FROM provider_connections WHERE id = ?");
    for (const pool of listPools().items) {
      const groupName = getGroupName(pool.groupId) ?? pool.name;
      for (const connectionId of pool.connectionIds) {
        // Cached/decrypted credential readers can retain metadata from an older
        // generation in another process. Read only authoritative routing metadata.
        const connection = providerFor.get(connectionId) as { provider: string } | undefined;
        if (!connection || typeof connection.provider !== "string") continue;
        const provider = connection.provider;
        for (const modelId of getProviderModelIds(provider)) {
          const name = quotaModelName(groupName, provider, modelId);
          let combo = desired.get(name);
          if (!combo) {
            combo = { name, models: [], strategy: QUOTA_SHARE_STRATEGY, isHidden: true };
            desired.set(name, combo);
            seen.set(name, new Set());
          }
          if (seen.get(name)!.has(connectionId)) continue;
          seen.get(name)!.add(connectionId);
          combo.models.push({ kind: "model", model: `${provider}/${modelId}`, providerId: provider, connectionId, weight: 100 });
        }
      }
    }

    // Preparation needs row names only, not deserialized routing payloads. The
    // fenced writer repairs desired corrupt JSON and deletes corrupt orphans.
    const pruneNames = (await listQuotaComboNames())
      .filter(name => isQuotaModelName(name) && !desired.has(name));
    if (applyQuotaComboReconciliation(generation, [...desired.values()], pruneNames)) return;
  }
  throw new Error(`Quota combo reconciliation remained contended for pool: ${poolId}`);
}

// ---------------------------------------------------------------------------
// Catalog filter helper (Phase B3)
// ---------------------------------------------------------------------------

/**
 * Given a flat model list and a set of pool slugs, return only the entries
 * whose `id` is a `quotaShared-*` virtual model name AND whose parsed
 * `poolSlug` is in `poolSlugs`.
 *
 * Fail-closed: an empty `poolSlugs` array returns an empty list — a
 * quota-exclusive API key with no resolvable pools sees NO models.
 *
 * Pure function — no I/O, easily unit-tested.
 */
export function filterModelsToQuotaPools<T extends { id: string }>(
  models: T[],
  poolSlugs: string[]
): T[] {
  if (poolSlugs.length === 0) return [];
  const slugSet = new Set(poolSlugs);
  return models.filter((m) => {
    if (!isQuotaModelName(m.id)) return false;
    const parsed = parseQuotaModelName(m.id);
    return parsed !== null && slugSet.has(parsed.groupSlug);
  });
}

/**
 * #4806 — Build the /v1/models catalog list for a quota-exclusive API key.
 *
 * The pool's qtSd/<group>/<provider>/<model> combos are isHidden:true, so the
 * base /v1/models list (which skips hidden combos) never contains them. Filtering
 * that base list therefore returned nothing and clients (e.g. Claude Desktop)
 * showed "0 modelo encontrado" once "Cota exclusiva" was enabled on the pool.
 *
 * This selects the (hidden) qtSd/* combos whose parsed group slug is in
 * `poolSlugs` and maps each through `toEntry` — the catalog's own combo-entry
 * builder — so it stays free of catalog-internal helpers and is unit-testable.
 *
 * Fail-closed: an empty `poolSlugs` array yields an empty list (a quota key with
 * no resolvable pools sees no models).
 */
export async function buildQuotaExclusiveModels<TCombo extends { name?: unknown }>(
  allowedQuotas: string[],
  combos: TCombo[],
  timestamp: number,
  metadataFor: (combo: TCombo) => Record<string, unknown>
): Promise<Array<Record<string, unknown>>> {
  const { resolveQuotaKeyScope } = await import("./quotaKey");
  const scope = await resolveQuotaKeyScope(allowedQuotas);
  if (scope.poolSlugs.length === 0) return [];
  const slugSet = new Set(scope.poolSlugs);
  const out: Array<Record<string, unknown>> = [];
  for (const combo of combos) {
    const name = typeof combo.name === "string" ? combo.name : "";
    if (!isQuotaModelName(name)) continue;
    const parsed = parseQuotaModelName(name);
    if (!parsed || !slugSet.has(parsed.groupSlug)) continue;
    out.push({
      id: name,
      object: "model",
      created: timestamp,
      owned_by: "combo",
      permission: [],
      root: name,
      parent: null,
      ...metadataFor(combo),
    });
  }
  return out;
}

/** Reconcile after deletion, retaining routes owned by surviving siblings. */
export async function removeQuotaCombosForPool(poolId: string, _snapshot?: Awaited<ReturnType<typeof resolvePoolForSync>>): Promise<void> {
  // Cleanup is the same generation-fenced projection as sync. An old snapshot
  // must never authorize deleting a newly created sibling's shared combo names.
  await syncQuotaCombos(poolId);
}

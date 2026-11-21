import { isModelExcludedByConnection } from "@/domain/connectionModelRules";
import {
  filterCodexEffortTiers,
  getCodexDefaultEffortTiers,
  isCodexReasoningBaseModel,
  splitCodexReasoningSuffix,
} from "@styxrouter/open-sse/executors/codex/reasoningSuffix.ts";
import { CATALOG_CODEX_NO_EFFORT_TIERS } from "@styxrouter/open-sse/services/catalogEffortContract.ts";
import { intersectStringArrays } from "./catalogHelpers";

type CodexConnectionLike = {
  id: string;
  providerSpecificData?: unknown;
};

type SyncedCodexModelLike = {
  id: string;
  supportsThinking?: boolean;
  supportedThinkingEfforts?: string[];
};

/**
 * Attach canonical Codex effort tiers to base Codex rows independently of
 * whether the caller requested expanded or compact mode, so base models have
 * identical `capabilities.effort_tiers` in both listings.
 *
 * Also returns the set of literal synced Codex model IDs across the scoped
 * connections so literal IDs win over alias suppression/rewriting on collision.
 */
export function attachCodexBaseEffortTiers<T extends Record<string, any>>(
  rows: T[],
  connections: ReadonlyArray<CodexConnectionLike>,
  syncedByConnection: Record<string, ReadonlyArray<SyncedCodexModelLike>>,
  getRegistryModel: (providerId: string, modelId: string) => { supportsReasoning?: boolean } | null
): { rows: T[]; literalSyncedIds: Set<string> } {
  const literalSyncedIds = new Set<string>();
  for (const conn of connections) {
    const syncedRows = syncedByConnection[conn.id];
    if (!Array.isArray(syncedRows)) continue;
    for (const sm of syncedRows) {
      if (sm?.id && !isModelExcludedByConnection(sm.id, conn.providerSpecificData)) {
        literalSyncedIds.add(sm.id);
      }
    }
  }

  const nextRows = rows.map((row) => {
    if (
      row.owned_by !== "codex" ||
      (row.type && row.type !== "chat") ||
      typeof row.root !== "string"
    ) {
      return row;
    }
    const modelId = row.root;
    const isLiteralSynced = literalSyncedIds.has(modelId);
    if (!isLiteralSynced && splitCodexReasoningSuffix(modelId).effort !== null) {
      return row;
    }

    const declaredTierSets: string[][] = [];
    let anyExplicitNoThinking = false;
    for (const conn of connections) {
      if (isModelExcludedByConnection(modelId, conn.providerSpecificData)) continue;
      const syncedRows = syncedByConnection[conn.id];
      if (!Array.isArray(syncedRows) || syncedRows.length === 0) continue;
      const match = syncedRows.find((sm) => sm.id === modelId);
      if (!match) continue;
      if (match.supportsThinking === false) {
        anyExplicitNoThinking = true;
        continue;
      }
      if (Array.isArray(match.supportedThinkingEfforts)) {
        declaredTierSets.push(filterCodexEffortTiers(modelId, match.supportedThinkingEfforts));
      }
    }

    if (anyExplicitNoThinking) {
      const existingCaps =
        row.capabilities && typeof row.capabilities === "object"
          ? { ...(row.capabilities as Record<string, unknown>) }
          : {};
      delete existingCaps.effort_tiers;
      return {
        ...row,
        [CATALOG_CODEX_NO_EFFORT_TIERS]: true,
        capabilities: {
          ...existingCaps,
          effort_configurable: false,
        },
      };
    }

    let tiers: string[] | undefined;
    if (declaredTierSets.length > 0) {
      const common = intersectStringArrays(declaredTierSets);
      if (common.length > 0) {
        tiers = common;
      } else {
        const existingCaps =
          row.capabilities && typeof row.capabilities === "object"
            ? { ...(row.capabilities as Record<string, unknown>) }
            : {};
        delete existingCaps.effort_tiers;
        return {
          ...row,
          [CATALOG_CODEX_NO_EFFORT_TIERS]: true,
          capabilities: {
            ...existingCaps,
            effort_configurable: false,
          },
        };
      }
    } else if (splitCodexReasoningSuffix(modelId).effort === null) {
      const regModel = getRegistryModel("codex", modelId);
      if (regModel?.supportsReasoning === true || isCodexReasoningBaseModel(modelId)) {
        tiers = getCodexDefaultEffortTiers(modelId);
      }
    }

    if (!tiers || tiers.length === 0) return row;
    const existingCaps =
      row.capabilities && typeof row.capabilities === "object"
        ? (row.capabilities as Record<string, unknown>)
        : {};
    return {
      ...row,
      capabilities: {
        ...existingCaps,
        reasoning: true,
        thinking: true,
        supportsThinking: true,
        effort_configurable: true,
        effort_tiers: tiers,
      },
    };
  });

  return { rows: nextRows, literalSyncedIds };
}

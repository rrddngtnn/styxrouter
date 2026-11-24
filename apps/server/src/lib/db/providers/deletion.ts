/**
 * db/providers/deletion.ts — Provider connection deletion & reordering.
 *
 * Extracted from db/providers.ts (god-file shrink): the three provider
 * connection delete paths plus the connection reorder helper they share.
 * Each delete path also purges the connection's account-scoped
 * proxy_assignments (#9232) so orphans never keep routing to removed
 * connections.
 */

import { getDbInstance } from "../core";
import { backupBeforeDestructiveWrite } from "../preWriteBackup";
import { cleanupComboConnectionRefs } from "../combos";
import { deleteLKGPByConnectionIds } from "../settings/lkgp";
import {
  removeConnectionHealth,
  removeConnectionIndex,
} from "@styxrouter/open-sse/services/apiKeyRotator.ts";
import { invalidateDbCache, invalidateModelCatalogCache } from "../readCache";
import { invalidateReasoningRoutingRuleCache } from "../reasoningRoutingRules";
import { removeCredentialHealth } from "../../credentialHealth/cache";
import { bumpProxyConfigGeneration } from "../settings";
import { toRecord } from "./columns";
import { reconcileCodexContextWindowsInTransaction } from "../../contextWindowResolver";

interface StatementLike<TRow = unknown> {
  all: (...params: unknown[]) => TRow[];
  get: (...params: unknown[]) => TRow | undefined;
  run: (...params: unknown[]) => { changes?: number };
}

interface DbLike {
  prepare: <TRow = unknown>(sql: string) => StatementLike<TRow>;
  transaction: <T>(fn: () => T) => () => T;
}

// Purge account-scoped proxy_assignments for the deleted connections (#9232):
// orphan assignments otherwise keep routing to provider_connections that no
// longer exist. scope='account' lives in exactly this one place.
function _deleteAccountProxyAssignments(db: DbLike, ids: string[]) {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => "?").join(",");
  db.prepare(
    `DELETE FROM proxy_assignments WHERE scope = 'account' AND scope_id IN (${placeholders})`
  ).run(...ids);
}

function _selectExistingConnections(db: DbLike, ids: string[]): Array<{ id: string; provider: string }> {
  if (ids.length === 0) return [];

  const placeholders = ids.map(() => "?").join(",");

  return db
    .prepare(`SELECT id, provider FROM provider_connections WHERE id IN (${placeholders})`)
    .all(...ids)
    .map((row) => {
      const record = toRecord(row);
      const id = typeof record.id === "string" ? record.id : null;
      if (!id) return null;
      const provider =
        typeof record.provider === "string" ? record.provider : String(record.provider || "");
      return { id, provider };
    })
    .filter((entry): entry is { id: string; provider: string } => entry !== null);
}

function _deleteConnectionCachesInTransaction(
  db: DbLike,
  connections: Array<{ id: string; provider: string }>
): boolean {
  if (connections.length === 0) return false;

  const ids = connections.map((c) => c.id);
  const idPlaceholders = ids.map(() => "?").join(",");
  db.prepare(
    `DELETE FROM key_value WHERE namespace = 'providerLimitsCache' AND key IN (${idPlaceholders})`
  ).run(...ids);

  const syncedKeys = connections
    .filter((c) => c.provider.length > 0)
    .map((c) => `${c.provider}:${c.id}`);
  if (syncedKeys.length === 0) return false;

  const syncedPlaceholders = syncedKeys.map(() => "?").join(",");
  const result = db
    .prepare(
      `DELETE FROM key_value WHERE namespace = 'syncedAvailableModels' AND key IN (${syncedPlaceholders})`
    )
    .run(...syncedKeys);
  return (result.changes ?? 0) > 0;
}

async function _cleanupDeletedComboConnectionRefs(connectionIds: string | string[]): Promise<void> {
  try {
    await cleanupComboConnectionRefs(connectionIds);
  } catch (error) {
    console.error("Failed to clean up combo route refs for deleted connections:", error);
  }
}

async function _cleanupDeletedLKGPConnectionRefs(connectionIds: string | string[]): Promise<void> {
  const ids = Array.isArray(connectionIds) ? connectionIds : [connectionIds];
  if (ids.length === 0) return;

  try {
    await deleteLKGPByConnectionIds(ids);
  } catch (error) {
    console.error("Failed to clean up LKGP refs for deleted connections:", error);
  }
}

async function _cleanupInMemoryConnectionCaches(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  for (const id of ids) {
    removeConnectionHealth(id);
    removeConnectionIndex(id);
    removeCredentialHealth(id);
  }
  await import("../../../domain/quotaCache")
    .then((module) => {
      for (const id of ids) module.removeConnectionQuotaCache(id);
    })
    .catch(() => {});
}

export async function deleteProviderConnection(id: string) {
  const db = getDbInstance() as unknown as DbLike;
  const existing = db.prepare("SELECT provider FROM provider_connections WHERE id = ?").get(id);
  if (!existing) return false;

  const existingRecord = toRecord(existing);
  const providerId =
    typeof existingRecord.provider === "string"
      ? existingRecord.provider
      : String(existingRecord.provider || "");

  await backupBeforeDestructiveWrite();
  let deletedSyncedModels = false;
  db.transaction(() => {
    _deleteAccountProxyAssignments(db, [id]);
    db.prepare("DELETE FROM quota_snapshots WHERE connection_id = ?").run(id);
    deletedSyncedModels = _deleteConnectionCachesInTransaction(db, [{ id, provider: providerId }]);
    db.prepare("DELETE FROM provider_connections WHERE id = ?").run(id);
    if (providerId === "codex") reconcileCodexContextWindowsInTransaction();
  })();

  await _cleanupDeletedComboConnectionRefs(id);
  await _cleanupDeletedLKGPConnectionRefs(id);
  void import("@styxrouter/open-sse/services/combo/nativeCodexTurnPin.ts")
    .then((module) => module.revokeNativeCodexTurnPinsForConnection(id))
    .catch(() => {});

  await _cleanupInMemoryConnectionCaches([id]);
  bumpProxyConfigGeneration();
  reorderConnections(db, providerId);
  // No post-write backup: the attempt precedes deletion.
  invalidateDbCache("connections"); // Bust connections read cache
  if (deletedSyncedModels) invalidateModelCatalogCache();
  invalidateReasoningRoutingRuleCache();
  return true;
}

export async function deleteProviderConnections(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;

  const db = getDbInstance() as unknown as DbLike;
  const existingConnections = _selectExistingConnections(db, ids);
  const existingIds = existingConnections.map((c) => c.id);

  if (existingIds.length === 0) return 0;
  await backupBeforeDestructiveWrite();
  let deletedSyncedModels = false;
  const deletedCount = db.transaction(() => {
    const placeholders = existingIds.map(() => "?").join(",");
    const hasCodex = !!db.prepare(`SELECT 1 FROM provider_connections WHERE provider = 'codex' AND id IN (${placeholders}) LIMIT 1`).get(...existingIds);

    db.prepare(`DELETE FROM quota_snapshots WHERE connection_id IN (${placeholders})`).run(...existingIds);

    _deleteAccountProxyAssignments(db, existingIds);
    deletedSyncedModels = _deleteConnectionCachesInTransaction(db, existingConnections);

    const result = db
      .prepare(`DELETE FROM provider_connections WHERE id IN (${placeholders})`)
      .run(...existingIds);

    if (hasCodex) reconcileCodexContextWindowsInTransaction();
    return result.changes ?? 0;
  })();

  await _cleanupDeletedComboConnectionRefs(existingIds);
  await _cleanupDeletedLKGPConnectionRefs(existingIds);

  for (const id of existingIds) {
    void import("@styxrouter/open-sse/services/combo/nativeCodexTurnPin.ts")
      .then((module) => module.revokeNativeCodexTurnPinsForConnection(id))
      .catch(() => {});
  }
  await _cleanupInMemoryConnectionCaches(existingIds);

  // No post-write backup: the attempt precedes deletion.
  invalidateDbCache("connections");
  if (deletedSyncedModels) invalidateModelCatalogCache();
  invalidateReasoningRoutingRuleCache();

  return deletedCount;
}

export async function deleteProviderConnectionsByProvider(providerId: string) {
  const db = getDbInstance() as unknown as DbLike;
  const connectionIds = db
    .prepare("SELECT id FROM provider_connections WHERE provider = ?")
    .all(providerId)
    .map((row) => {
      const record = toRecord(row);
      return typeof record.id === "string" ? record.id : null;
    })
    .filter((id): id is string => id !== null);

  if (connectionIds.length > 0) await backupBeforeDestructiveWrite();
  let deletedSyncedModels = false;
  const result = db.transaction(() => {
    if (connectionIds.length > 0) {
      const deleteSnapshots = db.prepare("DELETE FROM quota_snapshots WHERE connection_id = ?");
      for (const connectionId of connectionIds) {
        deleteSnapshots.run(connectionId);
      }
      _deleteAccountProxyAssignments(db, connectionIds);
      deletedSyncedModels = _deleteConnectionCachesInTransaction(
        db,
        connectionIds.map((id) => ({ id, provider: providerId }))
      );
    }
    if (connectionIds.length === 0) return { changes: 0 };
    const placeholders = connectionIds.map(() => "?").join(",");
    const deleted = db.prepare(`DELETE FROM provider_connections WHERE provider = ? AND id IN (${placeholders})`).run(providerId, ...connectionIds);
    if (providerId === "codex" && deleted.changes) reconcileCodexContextWindowsInTransaction();
    return deleted;
  })();

  await _cleanupDeletedComboConnectionRefs(connectionIds);
  await _cleanupDeletedLKGPConnectionRefs(connectionIds);

  for (const connectionId of connectionIds) {
    void import("@styxrouter/open-sse/services/combo/nativeCodexTurnPin.ts")
      .then((module) => module.revokeNativeCodexTurnPinsForConnection(connectionId))
      .catch(() => {});
  }
  await _cleanupInMemoryConnectionCaches(connectionIds);
  // No post-write backup: the attempt precedes deletion.
  invalidateDbCache("connections");
  if (deletedSyncedModels) invalidateModelCatalogCache();
  invalidateReasoningRoutingRuleCache();
  return result.changes;
}

export async function reorderProviderConnections(providerId: string) {
  const db = getDbInstance() as unknown as DbLike;
  reorderConnections(db, providerId);
}

export function reorderConnections(db: DbLike, providerId: string) {
  const rows = db
    .prepare(
      "SELECT id, priority, updated_at FROM provider_connections WHERE provider = ? ORDER BY priority ASC, updated_at DESC"
    )
    .all(providerId);

  const update = db.prepare("UPDATE provider_connections SET priority = ? WHERE id = ?");
  rows.forEach((row, index) => {
    const current = toRecord(row);
    update.run(index + 1, current.id);
  });
}

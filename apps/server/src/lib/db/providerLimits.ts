import {
  sanitizeProviderBillingStatus,
  type ProviderBillingStatus,
} from "@/shared/utils/providerBilling";
import { getDbInstance, isBuildPhase, isCloud } from "./core";
import { requireSynchronous, requireSynchronousCallback } from "./adapters/synchronous";

type JsonRecord = Record<string, unknown>;

interface StatementLike<TRow = unknown> {
  all: (...params: unknown[]) => TRow[];
  get: (...params: unknown[]) => TRow | undefined;
  run: (...params: unknown[]) => { changes?: number };
}

interface DbLike {
  prepare: <TRow = unknown>(sql: string) => StatementLike<TRow>;
  transaction: <T extends (...args: any[]) => unknown>(fn: T) => T;
  immediate: (fn: () => void) => void;
}

interface KeyValueRow {
  key: string;
  value: string;
}

export interface ProviderLimitsCacheEntry {
  quotas: JsonRecord | null;
  plan: unknown;
  message: string | null;
  fetchedAt: string;
  windowFetchedAt?: Record<string, string>;
  staleWindows?: string[];
  refreshFailed?: boolean;
  source?: string | null;
  bankedResetCredits?: number;
  billing?: ProviderBillingStatus;
}

const PROVIDER_LIMITS_CACHE_NAMESPACE = "providerLimitsCache";

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function toRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function sanitizeCacheEntryForStorage(entry: ProviderLimitsCacheEntry): ProviderLimitsCacheEntry {
  const { billing: rawBilling, ...rest } = entry;
  const billing = sanitizeProviderBillingStatus(rawBilling);
  return billing ? { ...rest, billing } : rest;
}

function normalizeCacheEntry(value: unknown): ProviderLimitsCacheEntry | null {
  const record = toRecord(value);
  if (!record) return null;

  const fetchedAt =
    typeof record.fetchedAt === "string" && record.fetchedAt.trim() ? record.fetchedAt : null;
  if (!fetchedAt) return null;

  const bankedResetCredits = Number(record.bankedResetCredits);
  const billing = sanitizeProviderBillingStatus(record.billing);

  const windowFetchedAt = toRecord(record.windowFetchedAt);
  const validWindowFetchedAt = windowFetchedAt
    ? Object.fromEntries(Object.entries(windowFetchedAt).filter(([, v]) => typeof v === "string" && v.trim() && Number.isFinite(Date.parse(v)))) as Record<string, string>
    : undefined;
  return {
    quotas: toRecord(record.quotas),
    ...(validWindowFetchedAt ? { windowFetchedAt: validWindowFetchedAt } : {}),
    ...(Array.isArray(record.staleWindows) ? { staleWindows: record.staleWindows.filter((v): v is string => typeof v === "string") } : {}),
    ...(record.refreshFailed === true ? { refreshFailed: true } : {}),
    plan: record.plan ?? null,
    message: typeof record.message === "string" ? record.message : null,
    fetchedAt,
    source: typeof record.source === "string" ? record.source : null,
    ...(Number.isFinite(bankedResetCredits) ? { bankedResetCredits } : {}),
    ...(billing ? { billing } : {}),
  };
}

export function getProviderLimitsCache(connectionId: string): ProviderLimitsCacheEntry | null {
  if (isBuildPhase || isCloud) return null;
  const db = getDbInstance() as unknown as DbLike;
  const row = db
    .prepare("SELECT value FROM key_value WHERE namespace = ? AND key = ?")
    .get(PROVIDER_LIMITS_CACHE_NAMESPACE, connectionId) as KeyValueRow | undefined;
  if (!row?.value) return null;
  return normalizeCacheEntry(parseJson(row.value));
}

/** Read the cache and its durable per-key revision in one SQLite snapshot. */
export function getProviderLimitsCacheSnapshot(connectionId: string): { entry: ProviderLimitsCacheEntry | null; revision: number } {
  if (isBuildPhase || isCloud) return { entry: null, revision: 0 };
  const db = getDbInstance() as unknown as DbLike;
  const row = db.prepare(`SELECT (SELECT value FROM key_value WHERE namespace = ? AND key = ?) AS value,
    COALESCE((SELECT revision FROM provider_limits_cache_revisions WHERE key = ?), 0) AS revision`)
    .get(PROVIDER_LIMITS_CACHE_NAMESPACE, connectionId, connectionId) as { value: string | null; revision: number };
  return { entry: row.value ? normalizeCacheEntry(parseJson(row.value)) : null, revision: row.revision };
}

export function getAllProviderLimitsCache(): Record<string, ProviderLimitsCacheEntry> {
  if (isBuildPhase || isCloud) return {};
  const db = getDbInstance() as unknown as DbLike;
  const rows = db
    .prepare("SELECT key, value FROM key_value WHERE namespace = ?")
    .all(PROVIDER_LIMITS_CACHE_NAMESPACE) as KeyValueRow[];

  const result: Record<string, ProviderLimitsCacheEntry> = {};
  for (const row of rows) {
    const parsed = normalizeCacheEntry(parseJson(row.value));
    if (parsed) {
      result[row.key] = parsed;
    }
  }
  return result;
}

export function setProviderLimitsCache(
  connectionId: string,
  entry: ProviderLimitsCacheEntry
): ProviderLimitsCacheEntry {
  const sanitized = sanitizeCacheEntryForStorage(entry);
  if (isBuildPhase || isCloud) return sanitized;
  const db = getDbInstance() as unknown as DbLike;
  db.prepare("INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES (?, ?, ?)").run(
    PROVIDER_LIMITS_CACHE_NAMESPACE,
    connectionId,
    JSON.stringify(sanitized)
  );
  return sanitized;
}

/** Atomically read and merge under the SQLite write lock, including across processes. */
export function updateProviderLimitsCache(
  connectionId: string,
  update: (previous: ProviderLimitsCacheEntry | null, revision: number) => ProviderLimitsCacheEntry | null
): ProviderLimitsCacheEntry | null {
  requireSynchronousCallback(update);
  if (isBuildPhase || isCloud) return requireSynchronous(update(null, 0));
  const db = getDbInstance() as unknown as DbLike;
  let result: ProviderLimitsCacheEntry | null = null;
  db.immediate(() => {
    const snapshot = getProviderLimitsCacheSnapshot(connectionId);
    result = requireSynchronous(update(snapshot.entry, snapshot.revision));
    if (result && result !== snapshot.entry) setProviderLimitsCache(connectionId, result);
  });
  return result;
}

export function setProviderLimitsCacheBatch(
  entries: Array<{ connectionId: string; entry: ProviderLimitsCacheEntry }>
): number {
  if (isBuildPhase || isCloud || entries.length === 0) return 0;
  const db = getDbInstance() as unknown as DbLike;
  const insert = db.prepare(
    "INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES (?, ?, ?)"
  );
  const tx = db.transaction(
    (items: Array<{ connectionId: string; entry: ProviderLimitsCacheEntry }>) => {
      for (const item of items) {
        insert.run(
          PROVIDER_LIMITS_CACHE_NAMESPACE,
          item.connectionId,
          JSON.stringify(sanitizeCacheEntryForStorage(item.entry))
        );
      }
    }
  );
  tx(entries);
  return entries.length;
}

export function deleteProviderLimitsCache(connectionId: string): void {
  if (isBuildPhase || isCloud) return;
  const db = getDbInstance() as unknown as DbLike;
  db.prepare("DELETE FROM key_value WHERE namespace = ? AND key = ?").run(
    PROVIDER_LIMITS_CACHE_NAMESPACE,
    connectionId
  );
}

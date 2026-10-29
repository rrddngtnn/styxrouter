import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { getCallLogsSync } from "@/lib/usage/callLogs";
import { getDbInstance } from "@/lib/db/core";
import { getCompletedDetails, getPendingById } from "@/lib/usage/usageHistory";
import { redactLogUrl } from "@/lib/logUrlRedaction";
import { sanitizeErrorForLog } from "@/lib/usage/callLogs/format";
import { getProviderConnections } from "@/lib/db/providers";
import { getProviderNodes } from "@/models";
// Use SQLite's own LIKE implementation for memory rows: wildcard, ASCII case,
// Unicode, and NULL semantics must agree with the persisted query.
function createSearchMatcher() {
  const statement = getDbInstance().prepare("SELECT ? LIKE ? AS matches");
  return (value: unknown, query: string): boolean => {
    if (value == null) return false;
    return Boolean((statement.get(String(value), `%${query}%`) as { matches: number }).matches);
  };
}

type CallLogListRowsInput = {
  logs: any[];
  connections: any[];
  providerDisplayNames?: Map<string, string>;
  pendingDetails: Iterable<any>;
  completedDetails: Iterable<any>;
  now?: number;
};

function rowTimestampMs(row: any): number {
  const value = Date.parse(String(row?.timestamp || ""));
  return Number.isFinite(value) ? value : 0;
}

function rowPriority(row: any): number {
  if (row?.active) return 0;
  if (row?.completed) return 1;
  return 2;
}

/**
 * Applies the active filter predicates to a single merged call-log row.
 *
 * `getCallLogs()` already filters the persisted DB rows server-side, but the
 * in-memory entries (active/pending + recently-completed) are merged in by
 * `buildCallLogListRows()` and would otherwise bypass every filter except
 * `correlationId`. Running the same predicates over the merged rows closes that
 * gap. It is idempotent for DB rows (they already satisfy the predicate) while
 * correctly excluding in-memory rows that do not match.
 */
export function rowMatchesFilter(row: any, filter: Record<string, any>, matchesSearch = createSearchMatcher()): boolean {
  if (!filter) return true;

  if (filter.status === "error") {
    if (!(Number(row?.status) >= 400 || Boolean(row?.error))) return false;
  } else if (filter.status === "ok") {
    if (!(Number(row?.status) >= 200 && Number(row?.status) < 300)) return false;
  } else if (filter.status) {
    const statusCode = Number.parseInt(filter.status, 10);
    if (!Number.isNaN(statusCode) && Number(row?.status) !== statusCode) return false;
  }

  if (filter.model && ![row?.model, row?.requestedModel].some((value) => matchesSearch(value || "", String(filter.model)))) {
    return false;
  }
  if (filter.provider && !matchesSearch(row?.provider || "", String(filter.provider))) {
    return false;
  }
  if (filter.account && !matchesSearch(row?.account || "", String(filter.account))) {
    return false;
  }
  if (filter.apiKey && ![row?.apiKeyName, row?.apiKeyId].some((value) => matchesSearch(value || "", String(filter.apiKey)))) {
    return false;
  }
  if (filter.combo && row?.comboName == null) {
    return false;
  }
  if (filter.correlationId && !matchesSearch(row?.correlationId || "", String(filter.correlationId))) {
    return false;
  }
  if (filter.excludeTests && !/^\/(?:api\/)?v1\//i.test(row?.path || "")) return false;
  if (filter.search) {
    const term = String(filter.search);
    if (![
      row?.model, row?.requestedModel, row?.provider, row?.account,
      row?.apiKeyName, row?.apiKeyId, row?.comboName, row?.comboStepId,
      row?.comboExecutionKey, row?.correlationId, row?.error, row?.path, row?.status,
    ].some((value) => matchesSearch(value, term))) return false;
  }

  return true;
}

export function buildCallLogListRows({
  logs,
  connections,
  providerDisplayNames = new Map<string, string>(),
  pendingDetails,
  completedDetails,
  now = Date.now(),
}: CallLogListRowsInput): any[] {
  const connectionNames = new Map(
    connections.map((connection: any) => [
      connection.id,
      connection.displayName || connection.name || connection.email || connection.id,
    ])
  );
  const getProviderDisplay = (providerId: unknown): string | null => {
    if (typeof providerId !== "string" || providerId.length === 0) return null;
    return providerDisplayNames.get(providerId) || null;
  };

  // Include active (in-flight) requests from the pending-by-id map
  // so they appear in the logs grid alongside persisted entries.
  const activeEntries: any[] = [];
  const persistedIds = new Set(logs.map((log: any) => log.id).filter(Boolean));

  for (const detail of pendingDetails) {
    activeEntries.push({
      id: detail.id,
      timestamp: new Date(detail.startedAt).toISOString(),
      method: "",
      path: redactLogUrl(detail.clientEndpoint || ""),
      status: 0,
      model: detail.model,
      requestedModel: null,
      provider: detail.provider,
      providerDisplay: getProviderDisplay(detail.provider),
      account: connectionNames.get(detail.connectionId || "") || detail.connectionId || "unknown",
      connectionId: detail.connectionId,
      duration: Math.max(0, now - detail.startedAt),
      tokens: { in: 0, out: 0 },
      cacheSource: null,
      sourceFormat: null,
      targetFormat: null,
      apiKeyId: null,
      apiKeyName: null,
      comboName: null,
      error: null,
      correlationId: detail.correlationId || null,
      active: true,
    });
  }

  const pendingIds = new Set(activeEntries.map((entry) => entry.id));
  const completedEntries: any[] = [];
  for (const detail of completedDetails) {
    if (persistedIds.has(detail.id) || pendingIds.has(detail.id)) continue;
    const completedAt = typeof detail.completedAt === "number" ? detail.completedAt : null;
    const duration =
      typeof detail.durationMs === "number" && Number.isFinite(detail.durationMs)
        ? detail.durationMs
        : Math.max(0, (completedAt ?? now) - detail.startedAt);
    completedEntries.push({
      id: detail.id,
      timestamp: new Date(detail.startedAt).toISOString(),
      method: "",
      path: redactLogUrl(detail.clientEndpoint || ""),
      status: typeof detail.status === "number" ? detail.status : detail.error ? 502 : 200,
      model: detail.model,
      requestedModel: null,
      provider: detail.provider,
      providerDisplay: getProviderDisplay(detail.provider),
      account: connectionNames.get(detail.connectionId || "") || detail.connectionId || "unknown",
      connectionId: detail.connectionId,
      duration,
      tokens: { in: 0, out: 0 },
      cacheSource: null,
      sourceFormat: null,
      targetFormat: null,
      apiKeyId: null,
      apiKeyName: null,
      comboName: null,
      error: sanitizeErrorForLog(detail.error || null),
      correlationId: detail.correlationId || null,
      active: false,
      completed: true,
      completedAt: completedAt ? new Date(completedAt).toISOString() : null,
      detailState: "in-memory",
    });
  }

  return [...activeEntries, ...completedEntries, ...logs].sort((a, b) => {
    // Active requests always on top
    const pa = rowPriority(a);
    const pb = rowPriority(b);
    if (pa !== pb) return pa - pb;
    // Within same priority, newest first
    return rowTimestampMs(b) - rowTimestampMs(a) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
  });
}

export async function GET(request: Request) {
  try {
    const authError = await requireManagementAuth(request);
    if (authError) return authError;

    const { searchParams } = new URL(request.url);

    const filter: Record<string, any> = {};
    if (searchParams.get("status")) filter.status = searchParams.get("status");
    if (searchParams.get("model")) filter.model = searchParams.get("model");
    if (searchParams.get("provider")) filter.provider = searchParams.get("provider");
    if (searchParams.get("account")) filter.account = searchParams.get("account");
    if (searchParams.get("apiKey")) filter.apiKey = searchParams.get("apiKey");
    if (searchParams.get("combo")) filter.combo = searchParams.get("combo");
    if (searchParams.get("search")) filter.search = searchParams.get("search");
    if (searchParams.get("correlationId")) filter.correlationId = searchParams.get("correlationId");
    const requestedLimit = Number(searchParams.get("limit"));
    const limit = Number.isSafeInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 500) : 200;
    const requestedOffset = Number(searchParams.get("offset"));
    const offset = Number.isSafeInteger(requestedOffset) && requestedOffset > 0 ? requestedOffset : 0;
    // Home Recent Requests feed sets excludeTests=1 so connection-test probe rows
    // are dropped at the SQL layer (before LIMIT), not client-side after slicing.
    if (searchParams.get("excludeTests") === "1") filter.excludeTests = true;

    const pending = [...getPendingById().values()];
    const completed = [...getCompletedDetails().values()];
    const [connections, providerNodes] = await Promise.all([
      getProviderConnections(),
      getProviderNodes(),
    ]);
    const providerDisplayNames = new Map<string, string>(
      (Array.isArray(providerNodes) ? providerNodes : []).flatMap((node: any) => {
        if (typeof node?.id !== "string" || node.id.length === 0) return [];
        const label =
          (typeof node?.name === "string" && node.name.trim().length > 0
            ? node.name.trim()
            : typeof node?.prefix === "string" && node.prefix.trim().length > 0
              ? node.prefix.trim()
              : "") || null;
        return label ? [[node.id, label] as const] : [];
      })
    );

    const db = getDbInstance();
    // Existence checks and the page must see the same database snapshot, even
    // when a different process persists one of the captured memory entries.
    const rows = db.transaction(() => {
      const ids = [...new Set([...pending, ...completed].map((entry: any) => entry.id).filter((id): id is string => typeof id === "string" && id.length > 0))];
      const persisted = new Set<string>();
      // Bound SQLite parameters and avoid one indexed query per entry.
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        const placeholders = chunk.map(() => "?").join(",");
        for (const row of db.prepare(`SELECT id FROM call_logs WHERE id IN (${placeholders})`).all(...chunk) as { id: string }[]) persisted.add(row.id);
      }
      const unpersisted = (entry: any) => !persisted.has(entry.id);
      const matchesSearch = createSearchMatcher();
      const memory = buildCallLogListRows({
        logs: [], connections, providerDisplayNames,
        pendingDetails: pending.filter(unpersisted),
        completedDetails: completed.filter(unpersisted),
      }).filter((row) => rowMatchesFilter(row, filter, matchesSearch));
      const memoryPage = memory.slice(offset, offset + limit);
      const dbOffset = Math.max(0, offset - memory.length);
      const remaining = limit - memoryPage.length;
      const logs = remaining > 0 ? getCallLogsSync({ ...filter, limit: remaining, offset: dbOffset }) : [];
      return [...memoryPage, ...logs];
    })();
    return Response.json(rows);
  } catch (error) {
    console.error("[API ERROR] /api/usage/call-logs failed:", error);
    return Response.json({ error: "Failed to fetch call logs" }, { status: 500 });
  }
}

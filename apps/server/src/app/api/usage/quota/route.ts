import { getProviderConnections } from "@/lib/localDb";
import {
  getLearnedLimits,
  getRateLimitStatus,
} from "@styxrouter/open-sse/services/rateLimitManager.ts";
import {
  getSanitizedCachedProviderLimitsMap,
  isSupportedUsageConnection,
} from "@/lib/usage/providerLimits.ts";
import {
  normalizeQuotaResponse,
  sanitizeQuotaProvider,
  type QuotaProviderEntry,
  type QuotaTokenStatus,
  type QuotaWindowEntry,
} from "@/shared/contracts/quota";

type ProviderConnectionRecord = Record<string, unknown>;

function toDateMs(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function deriveTokenStatus(connection: ProviderConnectionRecord): QuotaTokenStatus {
  const testStatus =
    typeof connection.testStatus === "string" ? connection.testStatus.toLowerCase() : "";

  if (testStatus === "expired") return "expired";
  if (testStatus === "refreshing") return "refreshing";

  const expiresAtMs = toDateMs(connection.tokenExpiresAt);
  if (expiresAtMs !== null) {
    const msRemaining = expiresAtMs - Date.now();
    // A short-lived access token that has run out is only "expired" when it cannot be renewed. An account that holds
    // a refresh token and passed its last check (handled above) gets a new access token on first use.
    if (msRemaining <= 0) {
      const hasRefreshToken = typeof connection.refreshToken === "string" && connection.refreshToken.length > 0;
      return hasRefreshToken ? "refreshable" : "expired";
    }
    if (msRemaining <= 15 * 60 * 1000) return "expiring";
  }

  const lastErrorType =
    typeof connection.lastErrorType === "string" ? connection.lastErrorType.toLowerCase() : "";
  if (lastErrorType.includes("refresh")) return "expiring";

  return "valid";
}

function deriveWindowPercent(q: Record<string, unknown>): {
  used: number | null;
  total: number | null;
  remaining: number | null;
  pct: number | null;
} {
  const used = toFiniteNumber(q.used);
  const total = toFiniteNumber(q.total);
  const remaining = toFiniteNumber(q.remaining);
  let pct = toFiniteNumber(q.remainingPercentage);

  // Some fetchers (e.g. Codex session/weekly) populate used/total/remaining without
  // remainingPercentage; others (e.g. GLM Start Plan) round remainingPercentage to an
  // integer, turning 634k/200M into 0% even though allowance remains. Derive exact
  // percentage whenever total > 0 and either remainingPercentage is missing or rounded
  // to 0 while remaining > 0.
  if (total !== null && total > 0) {
    const exactRem =
      remaining !== null ? Math.max(0, Math.min(total, remaining)) : used !== null ? Math.max(0, total - used) : null;
    if (exactRem !== null && (pct === null || (pct === 0 && exactRem > 0))) {
      pct = Math.round((exactRem / total) * 10000) / 100;
    }
  }

  return { used, total, remaining, pct };
}

/**
 * Collapse Antigravity's 15 per-tier model keys into clean model-family buckets
 * when sibling tiers share the exact same underlying quota pool (e.g. gemini-4-argon
 * low/medium/high share one pool; claude-sonnet-5-5 + claude-opus-5-5 + gpt-oss-120b
 * share one pool; gemini-3.8-flash + 3.1-flash-lite share one pool). Non-Antigravity
 * providers pass every window through untouched.
 */
function familyForAntigravityKey(key: string): { id: string; label: string; rank: number } {
  const k = key.toLowerCase();
  if (k.startsWith("gemini-4-argon")) return { id: "argon", label: "Gemini 4 Argon", rank: 1 };
  if (k.startsWith("claude-") || k.startsWith("gpt-oss")) {
    return { id: "claude", label: "Claude / GPT-OSS", rank: 2 };
  }
  if (k.startsWith("gemini-3")) return { id: "flash", label: "Gemini 3 Flash", rank: 3 };
  return { id: key, label: key, rank: 9 };
}

function extractCachedWindows(
  provider: string,
  quotas: Record<string, unknown> | null | undefined
): QuotaWindowEntry[] {
  if (!quotas || typeof quotas !== "object" || Array.isArray(quotas)) return [];

  const rawEntries: Array<QuotaWindowEntry & { rank: number }> = [];
  for (const [key, raw] of Object.entries(quotas)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const q = raw as Record<string, unknown>;
    const { used, total, remaining, pct } = deriveWindowPercent(q);
    const resetAt = typeof q.resetAt === "string" && q.resetAt.trim() ? q.resetAt.trim() : null;
    const unlimited = q.unlimited === true;
    const displayName =
      typeof q.displayName === "string" && q.displayName.trim() ? q.displayName.trim() : key;

    if (provider === "antigravity" || provider === "agy") {
      const fam = familyForAntigravityKey(key);
      // Merge tiers in the same family when they share the same pool signature.
      const sigReset = resetAt ?? "";
      const sigTotal = total ?? -1;
      const sigUsed = used ?? -1;
      const groupKey = `${fam.id}:${sigTotal}:${sigUsed}:${sigReset}`;
      if (rawEntries.some((w) => w.key === groupKey)) continue;
      rawEntries.push({
        key: groupKey,
        label: fam.label,
        used,
        total,
        remaining,
        percentRemaining: pct,
        resetAt,
        unlimited,
        rank: fam.rank,
      });
    } else {
      const niceLabel =
        key === "session"
          ? "5h Session"
          : key === "weekly"
            ? "Weekly"
            : displayName;
      rawEntries.push({
        key,
        label: niceLabel,
        used,
        total,
        remaining,
        percentRemaining: pct,
        resetAt,
        unlimited,
        rank: key === "session" ? 1 : key === "weekly" ? 2 : 5,
      });
    }
  }

  rawEntries.sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label));
  return rawEntries.map(({ rank: _rank, ...w }) => w);
}

function buildQuotaEntry(
  connection: ProviderConnectionRecord,
  learnedLimit: unknown,
  rateStatus: Record<string, unknown>
): QuotaProviderEntry {
  const provider =
    typeof connection.provider === "string" && connection.provider.trim()
      ? connection.provider
      : "unknown";
  const connectionId =
    typeof connection.id === "string" && connection.id.trim() ? connection.id : "unknown";
  const name =
    (typeof connection.name === "string" && connection.name.trim()) ||
    (typeof connection.email === "string" && connection.email.trim()) ||
    provider;
  const isActive = Boolean(connection.isActive ?? connection.is_active ?? true);
  const authType =
    typeof connection.authType === "string"
      ? connection.authType
      : typeof connection.auth_type === "string"
        ? connection.auth_type
        : null;
  const quotaSupported = isSupportedUsageConnection({
    id: connectionId,
    provider,
    authType: authType ?? undefined,
  });

  const resetAt =
    typeof connection.rateLimitedUntil === "string" && connection.rateLimitedUntil.trim()
      ? connection.rateLimitedUntil
      : null;

  let quotaTotal: number | null = null;
  let quotaUsed = 0;
  let percentRemaining = 100;
  const learned =
    learnedLimit && typeof learnedLimit === "object" && !Array.isArray(learnedLimit)
      ? (learnedLimit as Record<string, unknown>)
      : null;

  const learnedLimitValue =
    learned && typeof learned.limit === "number" && Number.isFinite(learned.limit)
      ? learned.limit
      : null;
  const learnedRemainingValue =
    learned && typeof learned.remaining === "number" && Number.isFinite(learned.remaining)
      ? learned.remaining
      : null;

  if (learnedLimitValue !== null && learnedLimitValue > 0) {
    quotaTotal = learnedLimitValue;
    const remaining =
      learnedRemainingValue !== null
        ? Math.min(Math.max(learnedRemainingValue, 0), learnedLimitValue)
        : learnedLimitValue;
    quotaUsed = learnedLimitValue - remaining;
    percentRemaining = (remaining / learnedLimitValue) * 100;
  } else {
    const resetAtMs = toDateMs(resetAt);
    if (resetAtMs !== null && resetAtMs > Date.now()) {
      quotaTotal = 100;
      quotaUsed = 100;
      percentRemaining = 0;
    } else {
      const queued = typeof rateStatus.queued === "number" ? rateStatus.queued : 0;
      const running = typeof rateStatus.running === "number" ? rateStatus.running : 0;
      const executing = typeof rateStatus.executing === "number" ? rateStatus.executing : 0;

      const syntheticUsage = Math.min(95, queued * 10 + running * 5 + executing * 3);
      if (syntheticUsage > 0) {
        quotaTotal = 100;
        quotaUsed = syntheticUsage;
        percentRemaining = 100 - syntheticUsage;
      }
    }
  }

  return sanitizeQuotaProvider({
    name,
    provider,
    connectionId,
    isActive,
    authType,
    plan: null,
    fetchedAt: null,
    message: null,
    quotaSupported,
    windows: [],
    quotaUsed,
    quotaTotal,
    percentRemaining,
    resetAt,
    tokenStatus: deriveTokenStatus(connection),
  });
}

function applyCachedLimits(
  entry: QuotaProviderEntry,
  cached:
    | {
        quotas?: Record<string, unknown> | null;
        plan?: string | null;
        fetchedAt?: string | null;
        message?: string | null;
      }
    | undefined
): QuotaProviderEntry {
  if (!cached) return entry;

  const windows = extractCachedWindows(entry.provider, cached.quotas ?? null);
  const plan = typeof cached.plan === "string" && cached.plan.trim() ? cached.plan.trim() : entry.plan;
  const fetchedAt =
    typeof cached.fetchedAt === "string" && cached.fetchedAt.trim() ? cached.fetchedAt.trim() : entry.fetchedAt;
  const message =
    typeof cached.message === "string" && cached.message.trim() ? cached.message.trim() : entry.message;

  let best: QuotaWindowEntry | null = null;
  for (const w of windows) {
    if (w.percentRemaining === null) continue;
    if (w.unlimited && !w.resetAt) continue;
    if (!best || w.percentRemaining < (best.percentRemaining ?? 101)) {
      best = w;
    }
  }

  if (!best) {
    return {
      ...entry,
      plan,
      fetchedAt,
      message,
      windows,
    };
  }

  const pct = best.percentRemaining ?? entry.percentRemaining;
  return {
    ...entry,
    plan,
    fetchedAt,
    message,
    windows,
    quotaTotal: best.total ?? 100,
    quotaUsed: best.used ?? Math.max(0, Math.round(100 - pct)),
    percentRemaining: pct,
    resetAt: best.resetAt ?? entry.resetAt,
  };
}

/**
 * GET /api/usage/quota
 *
 * Query params:
 *   - provider (optional): filter by provider slug
 *   - connectionId (optional): filter to a provider connection id
 *   - includeInactive (optional): "false" to exclude disabled accounts (default: include all)
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const providerFilter = searchParams.get("provider");
    const connectionIdFilter = searchParams.get("connectionId");
    const includeInactive = searchParams.get("includeInactive") !== "false";

    const connectionsRaw = await getProviderConnections(includeInactive ? {} : { isActive: true });
    let connections = Array.isArray(connectionsRaw) ? connectionsRaw : [];

    if (providerFilter) {
      connections = connections.filter((conn) => conn.provider === providerFilter);
    }
    if (connectionIdFilter) {
      connections = connections.filter((conn) => conn.id === connectionIdFilter);
    }

    const learnedLimits = getLearnedLimits();
    const limitsCache = await getSanitizedCachedProviderLimitsMap();
    const providers = connections.map((conn) => {
      const learnedLimit = learnedLimits?.[`${conn.provider}:${conn.id}`] || null;
      const rateStatus = getRateLimitStatus(conn.provider, conn.id);
      const entry = buildQuotaEntry(conn, learnedLimit, rateStatus);
      return applyCachedLimits(entry, limitsCache[conn.id]);
    });

    const response = normalizeQuotaResponse(
      {
        providers,
        meta: {
          generatedAt: new Date().toISOString(),
          filters: {
            provider: providerFilter,
            connectionId: connectionIdFilter,
          },
        },
      },
      {
        provider: providerFilter,
        connectionId: connectionIdFilter,
      }
    );

    return Response.json(response);
  } catch (error) {
    console.error("[API] GET /api/usage/quota error:", error);
    return Response.json({ error: "Failed to fetch quota data" }, { status: 500 });
  }
}

import { getProviderConnections } from "@/lib/localDb";
import {
  getLearnedLimits,
  getRateLimitStatus,
} from "@styxrouter/open-sse/services/rateLimitManager.ts";
import { getSanitizedCachedProviderLimitsMap } from "@/lib/usage/providerLimits.ts";
import {
  normalizeQuotaResponse,
  sanitizeQuotaProvider,
  type QuotaProviderEntry,
  type QuotaTokenStatus,
} from "@/shared/contracts/quota";

type ProviderConnectionRecord = Record<string, unknown>;

function toDateMs(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
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
      // Fallback synthetic signal from queue pressure when limit headers are unavailable.
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
    quotaUsed,
    quotaTotal,
    percentRemaining,
    resetAt,
    tokenStatus: deriveTokenStatus(connection),
  });
}

/**
 * Fold the freshest provider-limits cache entry into a quota row. The cache is
 * kept warm by the scheduled limits sync; without this fold the quota page only
 * showed learned header limits, which are empty until real traffic flows — the
 * "not checked on first open" gap. Prefers the cache's most-restrictive live
 * window (lowest remaining percentage with a reset time), keeping the learned
 * signal as fallback.
 */
function applyCachedLimits(
  entry: QuotaProviderEntry,
  cached: { quotas?: Record<string, unknown> | null } | undefined
): QuotaProviderEntry {
  const quotas = cached?.quotas;
  if (!quotas || typeof quotas !== "object") return entry;

  let best: { pct: number; used: number | null; total: number | null; resetAt: string | null } | null = null;
  for (const quota of Object.values(quotas)) {
    if (!quota || typeof quota !== "object" || Array.isArray(quota)) continue;
    const q = quota as Record<string, unknown>;
    const pct = typeof q.remainingPercentage === "number" && Number.isFinite(q.remainingPercentage)
      ? q.remainingPercentage
      : null;
    if (pct === null) continue;
    const unlimited = q.unlimited === true;
    const resetAt = typeof q.resetAt === "string" && q.resetAt ? q.resetAt : null;
    // Unlimited / no-reset windows (tab models) never describe the paid window.
    if (unlimited && !resetAt) continue;
    if (!best || pct < best.pct) {
      best = {
        pct,
        used: typeof q.used === "number" && Number.isFinite(q.used) ? q.used : null,
        total: typeof q.total === "number" && Number.isFinite(q.total) ? q.total : null,
        resetAt,
      };
    }
  }
  if (!best) return entry;

  return {
    ...entry,
    quotaTotal: best.total ?? 100,
    quotaUsed: best.used ?? Math.max(0, Math.round(100 - best.pct)),
    percentRemaining: best.pct,
    resetAt: best.resetAt ?? entry.resetAt,
  };
}

/**
 * GET /api/usage/quota
 *
 * Query params:
 *   - provider (optional): filter by provider slug
 *   - connectionId (optional): filter to a provider connection id
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const providerFilter = searchParams.get("provider");
    const connectionIdFilter = searchParams.get("connectionId");

    const connectionsRaw = await getProviderConnections({ isActive: true });
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

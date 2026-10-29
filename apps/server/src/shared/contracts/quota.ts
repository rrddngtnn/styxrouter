export type QuotaTokenStatus = "valid" | "expiring" | "expired" | "refreshing" | "refreshable";

export interface QuotaWindowEntry {
  key: string;
  label: string;
  models: string[];
  used: number | null;
  total: number | null;
  remaining: number | null;
  percentRemaining: number | null;
  resetAt: string | null;
  unlimited: boolean;
  fetchedAt?: string | null;
  stale?: boolean;
}

export interface QuotaProviderEntry {
  name: string;
  provider: string;
  connectionId: string;
  isActive: boolean;
  authType: string | null;
  plan: string | null;
  fetchedAt: string | null;
  message: string | null;
  quotaSupported: boolean;
  windows: QuotaWindowEntry[];
  quotaUsed: number;
  quotaTotal: number | null;
  percentRemaining: number | null;
  resetAt: string | null;
  tokenStatus: QuotaTokenStatus;
  /** CBCN credit observations are independent of routing cooldowns. */
  creditStatus?: "unknown" | "stale" | "observed";
  accountCooldownUntil?: string | null;
  /** Process-local model lockouts; other server processes may have different state. */
  modelCooldowns?: Array<{ model: string; reason: string; until: string }>;
}

export interface QuotaResponseMeta {
  generatedAt: string;
  filters: {
    provider: string | null;
    connectionId: string | null;
  };
  totalProviders: number;
}

export interface QuotaResponse {
  providers: QuotaProviderEntry[];
  meta: QuotaResponseMeta;
}

const TOKEN_STATUS_VALUES: QuotaTokenStatus[] = ["valid", "expiring", "expired", "refreshing", "refreshable"];

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeTokenStatus(value: unknown): QuotaTokenStatus {
  if (typeof value === "string" && TOKEN_STATUS_VALUES.includes(value as QuotaTokenStatus)) {
    return value as QuotaTokenStatus;
  }
  return "valid";
}

function sanitizeQuotaWindow(input: unknown): QuotaWindowEntry | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const src = input as Record<string, unknown>;
  const key = typeof src.key === "string" && src.key.trim() ? src.key.trim() : "";
  if (!key) return null;
  const label = typeof src.label === "string" && src.label.trim() ? src.label.trim() : key;
  const models = Array.isArray(src.models)
    ? src.models.filter((m): m is string => typeof m === "string" && m.trim().length > 0)
    : [];
  const used = toNumber(src.used);
  const total = toNumber(src.total);
  const remaining = toNumber(src.remaining);
  const pctRaw = toNumber(src.percentRemaining);
  const percentRemaining = pctRaw !== null ? clamp(pctRaw, 0, 100) : null;
  const resetAt = typeof src.resetAt === "string" && src.resetAt.trim() ? src.resetAt.trim() : null;
  return {
    key,
    label,
    models,
    used: used !== null && used >= 0 ? used : null,
    total: total !== null && total >= 0 ? total : null,
    remaining: remaining !== null && remaining >= 0 ? remaining : null,
    percentRemaining,
    resetAt,
    unlimited: src.unlimited === true,
    ...(typeof src.fetchedAt === "string" ? { fetchedAt: src.fetchedAt } : {}),
    ...(typeof src.stale === "boolean" ? { stale: src.stale } : {}),
  };
}

export function sanitizeQuotaProvider(input: unknown): QuotaProviderEntry {
  const source = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const provider = typeof source.provider === "string" ? source.provider : "unknown";
  const name = typeof source.name === "string" && source.name.trim() ? source.name : provider;
  const connectionId =
    typeof source.connectionId === "string" && source.connectionId.trim()
      ? source.connectionId
      : "unknown";

  const isActive = source.isActive !== false;
  const authType = typeof source.authType === "string" && source.authType.trim() ? source.authType.trim() : null;
  const plan = typeof source.plan === "string" && source.plan.trim() ? source.plan.trim() : null;
  const fetchedAt = typeof source.fetchedAt === "string" && source.fetchedAt.trim() ? source.fetchedAt.trim() : null;
  const message = typeof source.message === "string" && source.message.trim() ? source.message.trim() : null;
  const quotaSupported = source.quotaSupported !== false;
  const windowsRaw = Array.isArray(source.windows) ? source.windows : [];
  const windows = windowsRaw.map(sanitizeQuotaWindow).filter((w): w is QuotaWindowEntry => w !== null);

  const quotaTotalRaw = toNumber(source.quotaTotal);
  const quotaTotal = quotaTotalRaw !== null && quotaTotalRaw >= 0 ? quotaTotalRaw : null;

  const quotaUsedRaw = toNumber(source.quotaUsed) ?? 0;
  const quotaUsed =
    quotaTotal !== null ? clamp(quotaUsedRaw, 0, quotaTotal) : Math.max(0, quotaUsedRaw);

  let percentRemainingRaw = toNumber(source.percentRemaining);
  if (percentRemainingRaw === null) {
    if (quotaTotal && quotaTotal > 0) {
      percentRemainingRaw = ((quotaTotal - quotaUsed) / quotaTotal) * 100;
    } else {
      percentRemainingRaw = 100;
    }
  }
  const percentRemaining = provider === "codebuddy-cn" && source.creditStatus === "unknown"
    ? null : clamp(percentRemainingRaw, 0, 100);

  const resetAt =
    typeof source.resetAt === "string" && source.resetAt.trim() ? source.resetAt : null;

  return {
    name,
    provider,
    connectionId,
    isActive,
    authType,
    plan,
    fetchedAt,
    message,
    quotaSupported,
    windows,
    quotaUsed,
    quotaTotal,
    percentRemaining,
    resetAt,
    tokenStatus: normalizeTokenStatus(source.tokenStatus),
    ...(provider === "codebuddy-cn" && (source.creditStatus === "unknown" || source.creditStatus === "stale" || source.creditStatus === "observed") ? {
      creditStatus: source.creditStatus,
      accountCooldownUntil: typeof source.accountCooldownUntil === "string" && Number.isFinite(Date.parse(source.accountCooldownUntil)) ? source.accountCooldownUntil : null,
      modelCooldowns: Array.isArray(source.modelCooldowns) ? source.modelCooldowns.flatMap((item: unknown) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const lock = item as Record<string, unknown>;
        return typeof lock.model === "string" && lock.model && typeof lock.reason === "string" && typeof lock.until === "string" && Number.isFinite(Date.parse(lock.until))
          ? [{ model: lock.model, reason: lock.reason, until: lock.until }] : [];
      }) : [],
    } : {}),
  };
}

export function normalizeQuotaResponse(
  raw: unknown,
  filters: { provider?: string | null; connectionId?: string | null } = {}
): QuotaResponse {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const providersRaw = Array.isArray(source.providers)
    ? source.providers
    : Array.isArray(raw)
      ? raw
      : [];

  const providers = providersRaw.map((entry) => sanitizeQuotaProvider(entry));

  const sourceMeta =
    source.meta && typeof source.meta === "object" ? (source.meta as Record<string, unknown>) : {};
  const sourceFilters =
    sourceMeta.filters && typeof sourceMeta.filters === "object"
      ? (sourceMeta.filters as Record<string, unknown>)
      : {};

  const providerFilter =
    filters.provider ??
    (typeof sourceFilters.provider === "string" && sourceFilters.provider.trim()
      ? sourceFilters.provider
      : null);
  const connectionFilter =
    filters.connectionId ??
    (typeof sourceFilters.connectionId === "string" && sourceFilters.connectionId.trim()
      ? sourceFilters.connectionId
      : null);

  const generatedAt =
    typeof sourceMeta.generatedAt === "string" && sourceMeta.generatedAt.trim()
      ? sourceMeta.generatedAt
      : new Date().toISOString();

  return {
    providers,
    meta: {
      generatedAt,
      filters: {
        provider: providerFilter || null,
        connectionId: connectionFilter || null,
      },
      totalProviders: providers.length,
    },
  };
}

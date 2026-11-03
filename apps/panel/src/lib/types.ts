export interface Summary {
  totalRequests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  uniqueModels: number;
  uniqueAccounts: number;
  successfulRequests: number;
  successRatePct: number;
  avgLatencyMs: number;
  totalCost: number;
}
export interface Day {
  date: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
}
export interface ModelRow {
  model: string;
  provider: string;
  requests: number;
  totalTokens: number;
  avgLatencyMs: number;
  successRatePct: string | number;
  cost: number;
}
export interface ProviderRow {
  provider: string;
  providerId: string;
  requests: number;
  totalTokens: number;
  avgLatencyMs: number;
  successRatePct: string | number;
  cost: number;
}
export interface AccountRow {
  account: string;
  requests: number;
  totalTokens: number;
  avgLatencyMs: number;
  lastUsed: string | null;
  cost: number;
}
export interface KeyRow {
  apiKeyName: string;
  requests: number;
  totalTokens: number;
  cost: number;
}
export interface Analytics {
  range: string;
  provider?: string | null;
  summary: Summary;
  dailyTrend: Day[];
  byModel: ModelRow[];
  byProvider: ProviderRow[];
  byAccount: AccountRow[];
  byApiKey: KeyRow[];
  errorBreakdown: { errorType: string; count: number }[];
}

export interface Connection {
  id: string;
  provider: string;
  name: string | null;
  isActive: boolean;
  testStatus: string | null;
  lastError: string | null;
  backoffLevel: number;
  rateLimitedUntil: string | null;
  tokenExpiresAt: string | null;
}
export interface ProviderInfo {
  id: string;
  name?: string;
}
export interface QuotaWindow {
  key: string;
  label: string;
  models?: string[];
  used: number | null;
  total: number | null;
  remaining: number | null;
  percentRemaining: number | null;
  resetAt: string | null;
  unlimited: boolean;
  fetchedAt?: string | null;
  stale?: boolean;
}
export interface QuotaRow {
  name: string;
  provider: string;
  connectionId: string;
  isActive?: boolean;
  authType?: string | null;
  plan?: string | null;
  fetchedAt?: string | null;
  message?: string | null;
  quotaSupported?: boolean;
  windows?: QuotaWindow[];
  quotaUsed: number;
  quotaTotal: number | null;
  percentRemaining: number | null;
  resetAt: string | null;
  tokenStatus: string;
  bankedResetCredits?: number | null;
  bankedResetCreditsStale?: boolean;
  creditStatus?: "unknown" | "stale" | "observed";
  accountCooldownUntil?: string | null;
  modelCooldowns?: Array<{ model: string; reason: string; until: string }>;
}
export interface BackupRow {
  filename: string;
  createdAt: string;
  size: number;
  reason: string;
}

/** Accounts that need a look: switched off, failing their last test, backing off, or rate limited. */
export function accountProblem(c: Connection, now = Date.now()): string | null {
  if (!c.isActive) return null;
  if (c.rateLimitedUntil && Date.parse(c.rateLimitedUntil) > now) return "rate limited";
  if (c.testStatus && c.testStatus !== "active") return c.testStatus.replace(/_/g, " ");
  if (c.backoffLevel > 0) return `backing off (${c.backoffLevel})`;
  return null;
}

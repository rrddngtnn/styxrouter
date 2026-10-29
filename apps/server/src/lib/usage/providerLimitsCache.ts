import type { ProviderLimitsCacheEntry } from "@/lib/db/providerLimits";
import { sanitizeProviderBillingStatus } from "@/shared/utils/providerBilling";
import { GROK_BUILD_ADDITIONAL_CREDITS_URL } from "@/shared/utils/grokBilling";

const GROK_CLI_PROVIDER = "grok-cli";

/** Old cache entries may contain untrusted upstream text. */
export function sanitizeCodeBuddyCachedMessage(message: string): string {
  const safe = new Set([
    "CodeBuddy CN credential not available.",
    "CodeBuddy CN credential invalid or expired.",
    "CodeBuddy CN connected. No credit package found.",
    "CodeBuddy CN quota response has incomplete credit observations.",
    "CodeBuddy CN error: failed to fetch quota.",
    "CodeBuddy CN quota error: upstream request failed.",
  ]);
  if (safe.has(message) || /^CodeBuddy CN quota API error \([1-5][0-9]{2}\)\.$/.test(message)) return message;
  return "CodeBuddy CN quota error: upstream request failed.";
}

export function sanitizeCodeBuddyCache(entry: ProviderLimitsCacheEntry): ProviderLimitsCacheEntry {
  const quotas: Record<string, unknown> = {};
  let discarded = false;
  for (const [key, value] of Object.entries(entry.quotas ?? {})) {
    if (!/^(?:Monthly|Weekly|Daily)(?: (?:[2-9]|[1-9][0-9]+))?$|^Bonus Pack [1-9][0-9]*$/.test(key) || !value || typeof value !== "object" || Array.isArray(value)) { discarded = true; continue; }
    const q = value as Record<string, unknown>;
    const reset = typeof q.resetAt === "string" && Number.isFinite(Date.parse(q.resetAt)) ? new Date(q.resetAt).toISOString() : null;
    quotas[key] = { used: typeof q.used === "number" && Number.isFinite(q.used) && q.used >= 0 ? q.used : null, total: typeof q.total === "number" && Number.isFinite(q.total) && q.total >= 0 ? q.total : null, resetAt: reset, unlimited: false };
  }
  const timestamp = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : undefined;
  const windowFetchedAt = Object.fromEntries(Object.keys(quotas).flatMap(key => {
    const value = timestamp(entry.windowFetchedAt?.[key]);
    return value ? [[key, value]] : [];
  }));
  return { plan: entry.plan == null ? null : "CodeBuddy CN", message: entry.message ? sanitizeCodeBuddyCachedMessage(entry.message) : null, quotas: entry.quotas && !discarded ? quotas : null, windowFetchedAt, staleWindows: entry.staleWindows ? Object.keys(quotas).filter(key => entry.staleWindows!.includes(key)) : undefined, fetchedAt: timestamp(entry.fetchedAt) ?? new Date(0).toISOString(), refreshFailed: entry.refreshFailed === true };
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function observedWindows(quotas: JsonRecord | null): JsonRecord {
  return Object.fromEntries(Object.entries(quotas ?? {}).filter(([, value]) => isRecord(value) && Object.keys(value).length > 0));
}

/** A message without any observation is normally an error; Firecrawl's local mode is informational. */
export function isProviderLimitsErrorOnly(provider: string, entry: ProviderLimitsCacheEntry): boolean {
  if (!entry.message || Object.keys(observedWindows(entry.quotas)).length > 0 || entry.billing) return false;
  return !(provider === "firecrawl" && entry.plan === "Firecrawl · Self-Hosted Local" && entry.message.startsWith("Connected to self-hosted Firecrawl instance ("));
}

export function toProviderLimitsCacheEntry(
  usage: JsonRecord,
  source: string,
  fetchedAt = new Date().toISOString()
): ProviderLimitsCacheEntry {
  const bankedResetCredits = Number(usage.bankedResetCredits);
  return {
    quotas: isRecord(usage.quotas) ? usage.quotas : null,
    plan: usage.plan ?? null,
    message: typeof usage.message === "string" ? usage.message : null,
    fetchedAt,
    source,
    bankedResetCredits: Number.isFinite(bankedResetCredits) ? bankedResetCredits : undefined,
    billing: sanitizeProviderBillingStatus(usage.billing),
  };
}

export function mergeConcurrentProviderLimitsCacheEntry(
  provider: string,
  next: ProviderLimitsCacheEntry,
  previous: ProviderLimitsCacheEntry | null,
  initial: ProviderLimitsCacheEntry | null
): ProviderLimitsCacheEntry | null {
  if (provider === "codebuddy-cn") {
    if (previous) previous = sanitizeCodeBuddyCache(previous);
    if (initial) initial = sanitizeCodeBuddyCache(initial);
  }
  // An explicit concurrent deletion wins over an older in-flight fetch.
  if (initial && !previous) return null;
  if (isProviderLimitsErrorOnly(provider, next) && JSON.stringify(previous) !== JSON.stringify(initial)) return previous;
  if (!previous || !next.quotas || JSON.stringify(previous) === JSON.stringify(initial)) {
    return mergeProviderLimitsCacheEntry(provider, next, previous);
  }
  const isStale = (entry: ProviderLimitsCacheEntry | null, key: string) => Boolean(entry?.refreshFailed || (entry?.staleWindows
    ? entry.staleWindows.includes(key)
    : entry?.windowFetchedAt?.[key] && entry.windowFetchedAt[key] !== entry.fetchedAt));
  const changed = [...new Set([...Object.keys(initial?.quotas ?? {}), ...Object.keys(previous.quotas ?? {})])].filter(key =>
    JSON.stringify(previous.quotas?.[key]) !== JSON.stringify(initial?.quotas?.[key]) ||
    (previous.windowFetchedAt?.[key] ?? previous.fetchedAt) !== (initial?.windowFetchedAt?.[key] ?? initial?.fetchedAt) ||
    isStale(previous, key) !== isStale(initial, key)
  );
  const incoming = { ...next.quotas };
  for (const key of changed) delete incoming[key];
  const merged = mergeProviderLimitsCacheEntry(provider, { ...next, quotas: incoming }, previous, true);
  const stale = new Set(merged.staleWindows);
  for (const key of changed) {
    if (!Object.hasOwn(previous.quotas ?? {}, key)) continue;
    if (isStale(previous, key)) stale.add(key); else stale.delete(key);
  }
  return { ...merged, staleWindows: [...stale] };
}

export function mergeProviderLimitsCacheEntry(
  provider: string,
  next: ProviderLimitsCacheEntry,
  previous: ProviderLimitsCacheEntry | null | undefined,
  alreadyObserved = false
): ProviderLimitsCacheEntry {
  if (provider === "codebuddy-cn" && previous) {
    previous = sanitizeCodeBuddyCache(previous);
  }
  if (!alreadyObserved && isProviderLimitsErrorOnly(provider, next)) {
    return previous
      ? { ...previous, message: next.message, refreshFailed: true }
      : { ...next, refreshFailed: true };
  }
  if (next.quotas) {
    const observed = observedWindows(next.quotas);
    const windows = { ...previous?.quotas, ...observed };
    const windowFetchedAt: Record<string, string> = {};
    for (const key of Object.keys(windows)) {
      windowFetchedAt[key] = Object.hasOwn(observed, key)
        ? next.fetchedAt
        : previous?.windowFetchedAt?.[key] ?? previous!.fetchedAt;
    }
    const staleWindows = Object.keys(windows).filter(key => !Object.hasOwn(observed, key));
    next = { ...next, quotas: windows, windowFetchedAt, staleWindows };
  }
  if (!previous) return next;
  if (provider !== GROK_CLI_PROVIDER) return next;

  const nextBilling = next.billing;
  const previousBilling = previous.billing;
  if (
    !nextBilling ||
    nextBilling.additionalCreditsUrl !== GROK_BUILD_ADDITIONAL_CREDITS_URL ||
    nextBilling.autoTopUp.available ||
    !previousBilling ||
    previousBilling.additionalCreditsUrl !== GROK_BUILD_ADDITIONAL_CREDITS_URL
  )
    return next;

  return {
    ...next,
    billing: {
      ...nextBilling,
      autoTopUp: previousBilling.autoTopUp,
    },
  };
}

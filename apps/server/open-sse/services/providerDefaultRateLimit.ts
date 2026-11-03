/** Candidate replacement from provider quota contracts; no clean-room claim.
 * Keep proactive limits active even when adaptive headers are unavailable.
 */
import { SlidingWindowLimiter, type RateLimitWindow } from "./slidingWindowLimiter.ts";
const defaults: Record<string, RateLimitWindow> = { nvidia: { requests: 40, windowMs: 60_000 } };
export const PROVIDER_DEFAULT_CONCURRENCY_CAP: Record<string, number> = { nvidia: 6 };
type Quotas = Record<string, { rpm?: number; concurrency?: number }>;
let quotas: Quotas | null = null;
let testDefaults: Record<string, RateLimitWindow> | null = null;
const admissions = new SlidingWindowLimiter();
const positive = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;

export function __setProviderDefaultRateLimitsForTests(map: Record<string, RateLimitWindow> | null): void {
  testDefaults = map; admissions.reset();
}
export function setProviderQuotaOverrides(map: Quotas | null): void { quotas = map; }
export function getProviderDefaultRateLimit(provider: string): RateLimitWindow | undefined {
  const rpm = quotas?.[provider]?.rpm;
  if (positive(rpm)) return { requests: rpm, windowMs: 60_000 };
  const map = testDefaults ?? defaults;
  return Object.hasOwn(map, provider) ? map[provider] : undefined;
}
export function getProviderConcurrencyCap(provider: string, fallback: number): number {
  const configured = quotas?.[provider]?.concurrency;
  if (positive(configured)) return configured;
  return Object.hasOwn(PROVIDER_DEFAULT_CONCURRENCY_CAP, provider) ? PROVIDER_DEFAULT_CONCURRENCY_CAP[provider] : fallback;
}
export function acquireProviderDefaultSlot(provider: string, connectionId?: string | null): number {
  const window = getProviderDefaultRateLimit(provider);
  if (!window) return 0;
  const result = admissions.tryAcquire(JSON.stringify([provider, connectionId || "_"]), window);
  return result.allowed ? 0 : Math.max(1, result.retryAfterMs);
}
function abortError(): Error { return new DOMException("Quota wait aborted", "AbortError"); }
function delay(ms: number, signal: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(abortError()); return; }
    const cleanup = () => signal?.removeEventListener("abort", cancel);
    const cancel = () => { clearTimeout(timer); cleanup(); reject(abortError()); };
    const timer = setTimeout(() => { cleanup(); resolve(); }, ms);
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
  });
}
export async function awaitProviderDefaultSlot(provider: string, connectionId: string | null, signal: AbortSignal | null, maxWaitMs?: number): Promise<void> {
  const started = performance.now();
  let queued = false;
  for (;;) {
    if (signal?.aborted) throw abortError();
    // Timer delivery may be late. Check the deadline before reserving another
    // slot, not only after an unsuccessful acquisition.
    if (queued && positive(maxWaitMs) && performance.now() - started >= maxWaitMs) {
      throw new DOMException("Provider quota wait deadline exceeded", "TimeoutError");
    }
    const wait = acquireProviderDefaultSlot(provider, connectionId);
    if (!wait) return;
    const remaining = positive(maxWaitMs) ? maxWaitMs - (performance.now() - started) : Infinity;
    if (remaining <= 0) throw new DOMException("Provider quota wait deadline exceeded", "TimeoutError");
    queued = true;
    await delay(Math.min(wait, remaining), signal);
  }
}

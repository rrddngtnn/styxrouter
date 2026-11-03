/** Candidate contract-based replacement, not a source translation or clean-room claim.
 * Bounded key storage fails closed instead of evicting active quota history.
 */
export interface RateLimitWindow { requests: number; windowMs: number }
export interface AcquireResult { allowed: boolean; retryAfterMs: number }
export interface RateLimitScope { key: string; window: RateLimitWindow }
export interface SlidingWindowLease { release(): void }
export interface MultiAcquireResult extends AcquireResult { lease?: SlidingWindowLease }
type Reservation = { at: number; expires: number; token: symbol };

export class SlidingWindowLimiter {
  private records = new Map<string, Reservation[]>();
  private clock: () => number;
  constructor(options: { now?: () => number } = {}) { this.clock = options.now ?? Date.now; }

  tryAcquire(key: string, window: RateLimitWindow): AcquireResult {
    const { allowed, retryAfterMs } = this.tryAcquireMany([{ key, window }]);
    return { allowed, retryAfterMs };
  }

  tryAcquireMany(scopes: readonly RateLimitScope[]): MultiAcquireResult {
    const time = this.clock();
    const grouped = new Map<string, RateLimitWindow[]>();
    for (const { key, window } of scopes) {
      if (!Number.isFinite(window.requests) || !Number.isFinite(window.windowMs)) return { allowed: false, retryAfterMs: 1000 };
      if (window.requests <= 0 || window.windowMs <= 0) continue;
      const windows = grouped.get(key) ?? [];
      windows.push(window); grouped.set(key, windows);
    }
    if (!grouped.size) return { allowed: true, retryAfterMs: 0 };
    // Quotas can be changed by operators. Retain history at least as long as
    // originally configured; active calls using longer windows extend retention.
    for (const [key, windows] of grouped) {
      const duration = Math.max(...windows.map((w) => w.windowMs));
      for (const record of this.records.get(key) ?? []) record.expires = Math.max(record.expires, record.at + duration);
    }
    for (const [key, records] of this.records) {
      const active = records.filter((record) => record.expires > time);
      if (active.length) this.records.set(key, active); else this.records.delete(key);
    }
    let retry = 0;
    let missing = 0;
    for (const [key, windows] of grouped) {
      if (!this.records.has(key)) missing++;
      for (const window of windows) {
        const active = (this.records.get(key) ?? []).filter((record) => record.at > time - window.windowMs);
        if (active.length >= window.requests) retry = Math.max(retry, active[0].at + window.windowMs - time);
      }
    }
    if (this.records.size + missing > 5000) {
      let earliest = Infinity;
      for (const records of this.records.values()) earliest = Math.min(earliest, Math.max(...records.map((r) => r.expires)));
      retry = Math.max(retry, Number.isFinite(earliest) ? earliest - time : 1000);
    }
    if (retry > 0) return { allowed: false, retryAfterMs: Math.max(1, retry) };
    const token = Symbol();
    for (const [key, windows] of grouped) {
      const records = this.records.get(key) ?? [];
      records.push({ at: time, expires: time + Math.max(...windows.map((w) => w.windowMs)), token });
      this.records.set(key, records);
    }
    return { allowed: true, retryAfterMs: 0, lease: { release: () => {
      for (const key of grouped.keys()) {
        const retained = (this.records.get(key) ?? []).filter((record) => record.token !== token);
        if (retained.length) this.records.set(key, retained); else this.records.delete(key);
      }
    } } };
  }

  reset(key?: string): void {
    if (key === undefined) this.records.clear(); else this.records.delete(key);
  }
}

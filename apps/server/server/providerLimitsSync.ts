// Background auto-sync for the provider-limits cache. Upstream ran this from the
// Next instrumentation boot; the Hono host has no scheduler of its own, so the
// quota page opened on a cold cache showed "not checked" for every account until
// someone clicked Check now. This loop keeps the cache warm instead:
//   - first pass ~90 s after boot (lets migrations and the token-health settle),
//   - then every PROVIDER_LIMITS_SYNC_INTERVAL_MINUTES (default 70) it re-syncs
//     only when the newest scheduled run is older than the interval — a restart
//     neither skips a cycle nor double-fetches.
//   - like the token-health pass it is disabled in test/acceptance mode, and it
//     skips every connection an exclusive lease holds (fetchLiveProviderLimits
//     already defers those with a 409; filtering here avoids the noise).
// Fetches run through syncAllProviderLimits({ source: "scheduled" }), which
// serializes OAuth quota calls with spacing so upstreams never see a burst.
import {
  getLastProviderLimitsAutoSyncTime,
  getProviderLimitsSyncIntervalMs,
  syncAllProviderLimits,
} from "../src/lib/usage/providerLimits.ts";

const FIRST_PASS_DELAY_MS = 90_000;
const TICK_MS = 5 * 60 * 1000;

export function startProviderLimitsAutoSync(): void {
  if (
    process.env.STYX_TEST_MODE === "1" ||
    process.env.BUN_TEST ||
    process.env.DISABLE_PROVIDER_LIMITS_AUTO_SYNC === "1"
  ) {
    return;
  }

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const intervalMs = getProviderLimitsSyncIntervalMs();
      const last = await getLastProviderLimitsAutoSyncTime();
      const lastMs = last ? Date.parse(last) : NaN;
      if (Number.isFinite(lastMs) && Date.now() - lastMs < intervalMs) return;

      const result = await syncAllProviderLimits({ source: "scheduled" });
      if (result.total > 0) {
        console.log(
          `[LIMITS-SYNC] pass: ${result.succeeded}/${result.total} refreshed` +
            (result.failed > 0 ? `, ${result.failed} failed` : "")
        );
      }
    } catch (e) {
      console.warn("[LIMITS-SYNC] pass failed:", e instanceof Error ? e.message : e);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), TICK_MS);
  timer.unref?.();
  setTimeout(() => void tick(), FIRST_PASS_DELAY_MS).unref?.();
}

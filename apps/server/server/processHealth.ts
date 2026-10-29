import { Hono } from "hono";
import { tokenSchedulerHealth } from "./tokenSchedulerHealth";
import { readFile } from "node:fs/promises";
import { getOpenDbInstance } from "../src/lib/db/core";

// A snapshot keeps its original asOf: it is never relabelled as a newer observation.
// Bound staleness even when rows age into/out of a window without a database write.
const dispatchSnapshotTtlMs = 1000;
let dispatchSnapshot: { db: ReturnType<typeof getOpenDbInstance>; dataVersion: number; changes: number; expires: number; body: unknown } | undefined;

// Approximate wall-clock start captured once; uptime is monotonic thereafter.
const processStartedAt = new Date(Date.now() - process.uptime() * 1000).toISOString();

// Process-local measurements only; no host-wide or cross-worker claims.
export function createProcessHealthApi() {
  const app = new Hono();
  // Retained usage is an incomplete observation, not a provider eligibility signal.
  app.get("/dispatch", (c) => {
    c.header("Cache-Control", "no-store");
    const db = getOpenDbInstance();
    if (!db) return c.json({ error: "Usage history unavailable" }, 503);
    const started = performance.now();
    const now = Date.now();
    const hour = new Date(now - 3600000).toISOString();
    const day = new Date(now - 86400000).toISOString();
    const upper = new Date(now).toISOString();
    try {
      // data_version detects other connections; total_changes detects writes on this connection.
      // sql.js does not provide equivalent cross-process freshness; never cache it.
      const cacheable = db.driver !== "sql.js" && db.inTransaction === false;
      const version = cacheable ? Number((db.prepare("PRAGMA data_version").get() as any)?.data_version) : NaN;
      const changes = cacheable ? Number((db.prepare("SELECT total_changes() AS n").get() as any)?.n) : NaN;
      if (Number.isFinite(version) && Number.isFinite(changes) && dispatchSnapshot?.db === db &&
          dispatchSnapshot.dataVersion === version && dispatchSnapshot.changes === changes &&
          performance.now() < dispatchSnapshot.expires) {
        return c.json(dispatchSnapshot.body as any);
      }
      // SQLite compares offset-bearing timestamps lexically unless converted to instants.
      // Normalize returned last timestamps to UTC; invalid timestamps are excluded.
      const rows = db.prepare(`SELECT provider,
        strftime('%Y-%m-%dT%H:%M:%fZ', MAX(CASE WHEN success = 1 THEN julianday(timestamp) END)) AS lastSuccessAt,
        strftime('%Y-%m-%dT%H:%M:%fZ', MAX(CASE WHEN success = 0 THEN julianday(timestamp) END)) AS lastFailureAt,
        SUM(CASE WHEN julianday(timestamp) >= julianday(?) THEN 1 ELSE 0 END) AS hourRequests,
        SUM(CASE WHEN julianday(timestamp) >= julianday(?) AND success = 0 THEN 1 ELSE 0 END) AS hourFailures,
        SUM(CASE WHEN julianday(timestamp) >= julianday(?) THEN 1 ELSE 0 END) AS dayRequests,
        SUM(CASE WHEN julianday(timestamp) >= julianday(?) AND success = 0 THEN 1 ELSE 0 END) AS dayFailures
        FROM usage_history WHERE julianday(timestamp) <= julianday(?) AND provider IS NOT NULL AND provider <> '' AND success IN (0, 1)
        GROUP BY provider ORDER BY provider`).all(hour, hour, day, day, upper) as Array<Record<string, any>>;
      const body = { source: "retained_usage_history", asOf: upper, providers: rows.map((row) => ({
        provider: row.provider, lastSuccessAt: row.lastSuccessAt ?? null, lastFailureAt: row.lastFailureAt ?? null,
        hour: { requests: row.hourRequests, failures: row.hourFailures },
        day: { requests: row.dayRequests, failures: row.dayFailures },
      })) };
      if (Number.isFinite(version) && Number.isFinite(changes)) {
        dispatchSnapshot = { db, dataVersion: version, changes, expires: started + dispatchSnapshotTtlMs, body };
      }
      return c.json(body);
    } catch {
      return c.json({ error: "Usage history unavailable" }, 503);
    }
  });
  // Observations refer only to this process; resets on restart.
  app.get("/token-scheduler", (c) => {
    c.header("Cache-Control", "no-store");
    return c.json(tokenSchedulerHealth);
  });
  app.get("/start", (c) => {
    c.header("Cache-Control", "no-store");
    return c.json({ startedAt: processStartedAt });
  });
  // Linux reports maxRSS in KiB. Do not guess units on other platforms.
  app.get("/peak", (c) => {
    const kib = process.platform === "linux" ? process.resourceUsage().maxRSS : null;
    const bytes = kib === null ? null : kib * 1024;
    c.header("Cache-Control", "no-store");
    return c.json({ peakRssBytes: bytes !== null && Number.isSafeInteger(bytes) && bytes > 0 ? bytes : null });
  });
  // Cumulative CPU time for this process, not a host-wide utilization percentage.
  app.get("/cpu", (c) => {
    const cpu = process.cpuUsage();
    c.header("Cache-Control", "no-store");
    return c.json({ userMicroseconds: cpu.user, systemMicroseconds: cpu.system });
  });
  // Linux thread count for this process; unavailable rather than guessed elsewhere.
  app.get("/threads", async (c) => {
    let threadCount: number | null = null;
    if (process.platform === "linux") {
      try {
        const status = await readFile("/proc/self/status", "utf8");
        const match = /^Threads:\s+(\d+)\s*$/m.exec(status);
        const count = match ? Number(match[1]) : NaN;
        if (Number.isSafeInteger(count) && count > 0) threadCount = count;
      } catch { /* unavailable */ }
    }
    c.header("Cache-Control", "no-store");
    return c.json({ threadCount });
  });
  app.get("/swap", async (c) => {
    let swapBytes: number | null = null;
    if (process.platform === "linux") {
      try {
        const status = await readFile("/proc/self/status", "utf8");
        const match = /^VmSwap:\s+(\d+)\s+kB\s*$/m.exec(status);
        const bytes = match ? Number(match[1]) * 1024 : NaN;
        if (Number.isSafeInteger(bytes) && bytes >= 0) swapBytes = bytes;
      } catch { /* unavailable */ }
    }
    c.header("Cache-Control", "no-store");
    return c.json({ swapBytes });
  });
  app.get("/", (c) => {
    const memory = process.memoryUsage();
    c.header("Cache-Control", "no-store");
    return c.json({
      uptimeSeconds: process.uptime(),
      memory: {
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        heapTotalBytes: memory.heapTotal,
      },
    });
  });
  return app;
}

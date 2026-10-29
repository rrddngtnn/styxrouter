import { stat } from "node:fs/promises";
import { Hono } from "hono";
import { getOpenDbInstance, SQLITE_FILE } from "../src/lib/db/core";

// Null means unavailable or absent, not zero; no database files are opened or changed.
async function fileSize(path: string | null): Promise<number | null> {
  if (!path) return null;
  try {
    const info = await stat(path);
    return info.isFile() && Number.isSafeInteger(info.size) ? info.size : null;
  } catch {
    return null;
  }
}

export function createStorageHealthApi() {
  const app = new Hono();
  // This records only successful runs through the vacuum scheduler, not other VACUUM calls.
  app.get("/vacuum", (c) => {
    let lastSuccessfulSchedulerVacuumAt: number | null = null;
    try {
      const row = getOpenDbInstance()?.prepare("SELECT value FROM key_value WHERE namespace = ? AND key = ? LIMIT 1").get("scheduler", "vacuum") as { value?: string } | undefined;
      const value: unknown = row?.value ? JSON.parse(row.value) : null;
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const timestamp = (value as Record<string, unknown>).lastRunAt;
        if (typeof timestamp === "number" && Number.isSafeInteger(timestamp) && timestamp > 0 && timestamp <= Date.now()) lastSuccessfulSchedulerVacuumAt = timestamp;
      }
    } catch { /* unavailable or malformed */ }
    c.header("Cache-Control", "no-store");
    return c.json({ lastSuccessfulSchedulerVacuumAt });
  });
  app.get("/", async (c) => {
    const [databaseBytes, walBytes] = await Promise.all([
      fileSize(SQLITE_FILE),
      fileSize(SQLITE_FILE ? `${SQLITE_FILE}-wal` : null),
    ]);
    c.header("Cache-Control", "no-store");
    return c.json({ databaseBytes, walBytes });
  });
  return app;
}

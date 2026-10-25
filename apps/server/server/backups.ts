// Database backups for the Hono host. Files use upstream's naming (db_<timestamp>_<reason>.sqlite, in
// <DATA_DIR>/db_backups) so its tooling still sees them, but this module does its own, narrower pruning: only the
// backups it made on a schedule are ever deleted. Anything else in the folder belongs to the operator.
import { Hono } from "hono";
import { chmodSync, existsSync, mkdirSync, readdirSync, statSync, statfsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { DB_BACKUPS_DIR, SQLITE_FILE, getDbInstance } from "../src/lib/db/core.ts";

export type BackupInfo = { id: string; filename: string; createdAt: string; size: number; reason: string };

const NAME = /^db_(.+?)_([^.]+)\.sqlite$/;

/** Newest first. Reads the folder only: nothing is opened, so listing a folder of large snapshots stays cheap. */
export function listBackups(dir: string | null = DB_BACKUPS_DIR): BackupInfo[] {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir)
    .map((filename) => ({ filename, m: NAME.exec(filename) }))
    .filter((e): e is { filename: string; m: RegExpExecArray } => e.m !== null)
    .map(({ filename, m }) => {
      const st = statSync(join(dir, filename));
      return { id: filename, filename, createdAt: st.mtime.toISOString(), size: st.size, reason: m[2], mtime: st.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime)
    .map(({ mtime: _m, ...rest }) => rest);
}

/** Delete scheduled backups beyond the newest `keep`; returns the removed file names. */
export function pruneScheduled(dir: string, keep: number): string[] {
  const doomed = listBackups(dir)
    .filter((b) => b.reason === "scheduled")
    .slice(Math.max(1, keep));
  for (const b of doomed) unlinkSync(join(dir, b.filename));
  return doomed.map((b) => b.filename);
}

export type BackupResult = { ok: true; filename: string; size: number } | { ok: false; error: string };

/** Snapshot the live database (SQLite's own online backup, consistent while the router is serving). */
export async function backupNow(reason: "manual" | "scheduled"): Promise<BackupResult> {
  if (!SQLITE_FILE || !DB_BACKUPS_DIR) return { ok: false, error: "Backups are not available in this deployment" };
  mkdirSync(DB_BACKUPS_DIR, { recursive: true, mode: 0o700 });
  const dbBytes = statSync(SQLITE_FILE).size;
  const fs = statfsSync(DB_BACKUPS_DIR);
  // Refuse rather than fill the disk the router also runs on: need the copy plus the same again and some headroom (STYX_BACKUP_MIN_FREE_MB, default 512).
  const headroom = Math.max(0, Number(process.env.STYX_BACKUP_MIN_FREE_MB ?? 512) || 0) * 1024 * 1024;
  if (fs.bavail * fs.bsize < dbBytes * 2 + headroom) {
    return { ok: false, error: "Not enough free disk space for a backup" };
  }
  const filename = `db_${new Date().toISOString().replace(/[:.]/g, "-")}_${reason}.sqlite`;
  const file = join(DB_BACKUPS_DIR, filename);
  await (getDbInstance() as unknown as { backup(f: string): Promise<unknown> }).backup(file);
  chmodSync(file, 0o600);
  return { ok: true, filename, size: statSync(file).size };
}

export function createBackupsApi() {
  const api = new Hono();
  api.get("/backups", (c) => c.json({ backups: listBackups() }));
  api.post("/backups", async (c) => {
    const r = await backupNow("manual");
    return r.ok ? c.json({ filename: r.filename, size: r.size }, 201) : c.json({ error: r.error }, 507);
  });
  return api;
}

/**
 * Daily scheduled backup. Checks hourly whether the newest scheduled backup is older than the interval, so a restart
 * neither skips a day nor makes an extra copy. STYX_BACKUP_INTERVAL_HOURS=0 turns it off; STYX_BACKUP_KEEP (default 7)
 * is how many scheduled backups are kept.
 */
export function startBackupScheduler() {
  const hours = Number(process.env.STYX_BACKUP_INTERVAL_HOURS ?? 24);
  if (!Number.isFinite(hours) || hours <= 0 || process.env.STYX_TEST_MODE || !DB_BACKUPS_DIR) return;
  const keep = Math.max(1, Number(process.env.STYX_BACKUP_KEEP ?? 7) || 7);
  const tick = async () => {
    try {
      const last = listBackups(DB_BACKUPS_DIR).find((b) => b.reason === "scheduled");
      if (last && Date.now() - Date.parse(last.createdAt) < hours * 3_600_000) return;
      const r = await backupNow("scheduled");
      if (!r.ok) return void console.warn(`[BACKUP] skipped: ${r.error}`);
      const gone = pruneScheduled(DB_BACKUPS_DIR, keep);
      console.log(`[BACKUP] ${r.filename} (${r.size} bytes)${gone.length ? `, pruned ${gone.length} older scheduled` : ""}`);
    } catch (e) {
      console.error("[BACKUP] failed:", e instanceof Error ? e.message : e);
    }
  };
  setTimeout(tick, 2 * 60_000).unref?.();
  setInterval(tick, 3_600_000).unref?.();
}

// Best-effort snapshot for selected async destructive operations. Other writers
// (including other processes) are not serialized with this backup.
import fs from "node:fs";
import path from "node:path";
import { DB_BACKUPS_DIR, SQLITE_FILE, getDbInstance, isBuildPhase, isCloud } from "./core";
import { isAutoBackupDisabledBySetting, cleanupDbBackups } from "./backup";
import { backupHasSpace, backupHeadroomBytes } from "./backupSpace";
import { isAutomatedTestProcess } from "@/shared/utils/testProcess";
import { tryOpenSync } from "./adapters/driverFactory";

export async function backupBeforeDestructiveWrite(): Promise<void> {
  if (isBuildPhase || isCloud || isAutomatedTestProcess() ||
      /^(1|true|yes|on)$/i.test((process.env.DISABLE_SQLITE_AUTO_BACKUP || "").trim()) ||
      isAutoBackupDisabledBySetting() || !SQLITE_FILE || !DB_BACKUPS_DIR) return;
  let staging: string | undefined;
  try {
    if (!fs.existsSync(SQLITE_FILE) || fs.statSync(SQLITE_FILE).size < 4096) return;
    fs.mkdirSync(DB_BACKUPS_DIR, { recursive: true, mode: 0o700 });
    if (!backupHasSpace(SQLITE_FILE, DB_BACKUPS_DIR, backupHeadroomBytes())) {
      console.warn("[DB] Pre-write backup skipped: insufficient space");
      return;
    }
    staging = fs.mkdtempSync(path.join(DB_BACKUPS_DIR, ".backup-"));
    const staged = path.join(staging, "snapshot.sqlite");
    await getDbInstance().backup(staged);
    fs.chmodSync(staged, 0o600);
    const snapshot = tryOpenSync(staged, { readonly: true });
    if (!snapshot) throw new Error("Cannot validate backup: no native SQLite driver");
    try {
      const rows = snapshot.pragma("integrity_check") as Array<Record<string, unknown>>;
      if (!Array.isArray(rows) || rows.length !== 1 || Object.values(rows[0] ?? {})[0] !== "ok") {
        throw new Error("Backup integrity check failed");
      }
    } finally { snapshot.close(); }
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const suffix = path.basename(staging).slice(".backup-".length);
    fs.linkSync(staged, path.join(DB_BACKUPS_DIR, `db_${timestamp}-${suffix}_pre-write.sqlite`));
    cleanupDbBackups();
  } catch (error) {
    console.error("[DB] Pre-write backup failed:", error instanceof Error ? error.message : String(error));
  } finally {
    if (staging) {
      try { fs.rmSync(staging, { recursive: true, force: true }); }
      catch { console.error("[DB] Could not remove pre-write backup staging directory"); }
    }
  }
}

import { statSync, statfsSync } from "node:fs";

/** Estimate both database and uncheckpointed WAL, with an additional copy as safety margin. */
export function backupHasSpace(database: string, backupDir: string, headroomBytes: bigint): boolean {
  const exact = (value: number | bigint): bigint => {
    if (typeof value === "bigint") return value;
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("Cannot safely estimate backup disk space");
    return BigInt(value);
  };
  const dbBytes = exact(statSync(database, { bigint: true }).size);
  let walBytes = 0n;
  try {
    walBytes = exact(statSync(`${database}-wal`, { bigint: true }).size);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const fs = statfsSync(backupDir, { bigint: true });
  return exact(fs.bavail) * exact(fs.bsize) >= (dbBytes + walBytes) * 2n + headroomBytes;
}

export function backupHeadroomBytes(): bigint {
  const configured = Number(process.env.STYX_BACKUP_MIN_FREE_MB ?? 512);
  const headroom = Number.isFinite(configured) ? Math.max(0, configured) : 512;
  return BigInt(Math.ceil(headroom * 1024 * 1024));
}

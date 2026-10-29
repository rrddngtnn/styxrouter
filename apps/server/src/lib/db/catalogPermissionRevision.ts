import { getDbInstance } from "./core";

/**
 * Fresh SQLite read, never a TTL cache: another process can change permissions
 * without touching quota membership or running a combo-maintenance worker.
 * Missing/corrupt state fails closed instead of replaying a permissive catalog.
 */
export function getCatalogPermissionRevision(): number {
  const row = getDbInstance()
    .prepare("SELECT value FROM db_meta WHERE key = 'catalog_permission_revision'")
    .get() as { value: string } | undefined;
  const revision = Number(row?.value);
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new Error("Catalog permission revision is unavailable or invalid");
  }
  return revision;
}

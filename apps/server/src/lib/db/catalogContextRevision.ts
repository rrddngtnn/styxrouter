import { getDbInstance } from "./core";

/** Cross-process catalog discovery revision; read freshly, never cache. */
export function getCatalogContextRevision(): number {
  const row = getDbInstance().prepare("SELECT value FROM db_meta WHERE key = 'catalog_context_revision'").get() as { value: string } | undefined;
  const revision = Number(row?.value);
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error("Catalog context revision is unavailable or invalid");
  return revision;
}

import { createHmac, randomUUID } from "node:crypto";
import type { SqliteAdapter } from "./adapters/types";
import { decrypt, encrypt, hasCurrentEncryptionKey } from "./encryption";
import { invalidateDbCache } from "./readCache";

// Shared primitives only: no refresh path calls these until all callers can
// prove they hold the claim throughout network and durable persistence.
const namespace = "imported_refresh_claim_v1";
const denied = () => new Error("Imported refresh unavailable; re-authenticate the connection");
function identityKey(refresh: string, provider?: string): string {
  if (!hasCurrentEncryptionKey()) throw denied();
  const secret = process.env.STORAGE_ENCRYPTION_KEY!;
  return createHmac("sha256", secret).update("styx-imported-refresh-claim-v1\0").update(provider || "").update("\0").update(refresh).digest("hex");
}
function assertDurable(db: SqliteAdapter) {
  if (db.driver === "sql.js" || !db.name || db.name === ":memory:" || db.inTransaction) throw denied();
  const synchronous = Number(db.pragma("synchronous", { simple: true }));
  if (!Number.isFinite(synchronous) || synchronous < 2) throw denied();
}
function rowFor(db: SqliteAdapter, id: string, expectedRefresh: string, expectedProvider?: string) {
  const row = db.prepare("SELECT * FROM provider_connections WHERE id = ?").get(id) as { provider?: string; refresh_token: string; provider_specific_data: string } | undefined;
  if (expectedProvider && row?.provider !== expectedProvider) throw denied();
  let metadata: any;
  try { metadata = JSON.parse(row?.provider_specific_data || "{}"); } catch { throw denied(); }
  if (!row || metadata?.importedToken !== true || !row.refresh_token?.startsWith("enc:v1:") || !hasCurrentEncryptionKey() || decrypt(row.refresh_token, { quiet: true }) !== expectedRefresh) throw denied();
  return row;
}
export function claimImportedRefresh(db: SqliteAdapter, id: string, expectedRefresh: string, expectedProvider?: string): string {
  assertDurable(db);
  if (!id || !expectedRefresh) throw denied();
  const token = randomUUID();
  db.immediate(() => {
    const row = rowFor(db, id, expectedRefresh, expectedProvider);
    const key = identityKey(expectedRefresh, row.provider);
    db.exec("CREATE TABLE IF NOT EXISTS imported_refresh_used_v1 (key TEXT PRIMARY KEY NOT NULL)");
    if (db.prepare("SELECT key FROM imported_refresh_used_v1 WHERE key = ?").get(key)) throw denied();
    if (db.prepare("SELECT value FROM key_value WHERE namespace = ? AND key = ?").get(namespace, key)) throw denied();
    db.prepare("INSERT INTO key_value (namespace, key, value) VALUES (?, ?, ?)").run(namespace, key, token);
  });
  return token;
}
export function finishImportedRefresh(db: SqliteAdapter, id: string, token: string, expectedRefresh: string, access: string, refresh: string, expiresAt: string | null, expectedProvider?: string): void {
  assertDurable(db);
  if (!id || !token || !expectedRefresh || !access || !refresh) throw denied();
  db.immediate(() => {
    const row = rowFor(db, id, expectedRefresh, expectedProvider);
    const key = identityKey(expectedRefresh, row.provider);
    const claim = db.prepare("SELECT value FROM key_value WHERE namespace = ? AND key = ?").get(namespace, key) as { value: string } | undefined;
    if (claim?.value !== token) throw denied();
    const secure = (value: string) => {
      if (!hasCurrentEncryptionKey()) throw denied();
      const cipher = encrypt(value);
      if (!cipher?.startsWith("enc:v1:") || decrypt(cipher, { quiet: true }) !== value) throw denied();
      return cipher;
    };
    const accessCipher = secure(access), refreshCipher = secure(refresh);
    const updated = db.prepare("UPDATE provider_connections SET access_token = ?, refresh_token = ?, expires_at = ?, token_expires_at = ?, updated_at = ? WHERE id = ?").run(accessCipher, refreshCipher, expiresAt, expiresAt, new Date().toISOString(), id);
    if (updated.changes !== 1) throw denied();
    db.prepare("INSERT INTO config_audit_log (id, timestamp, action, target, target_id, target_name, before_json, after_json, diff_json, source, note) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, NULL)")
      .run(randomUUID(), new Date().toISOString(), "imported_refresh", "provider_connection", id, "", "{}", "system");
    db.prepare("INSERT INTO imported_refresh_used_v1 (key) VALUES (?)").run(key);
    if (db.prepare("DELETE FROM key_value WHERE namespace = ? AND key = ? AND value = ?").run(namespace, key, token).changes !== 1) throw denied();
  });
  invalidateDbCache("connections");
}

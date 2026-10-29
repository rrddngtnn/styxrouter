import { createHmac, randomUUID } from "node:crypto";
import type { SqliteAdapter } from "./adapters/types";
import { decrypt, encrypt, hasCurrentEncryptionKey } from "./encryption";
import { invalidateDbCache } from "./readCache";

export type ImportedCredential = {
  provider: string;
  authType: "oauth" | "apikey";
  access: string;
  refresh?: string;
  name: string;
  expiresAt: string | null;
  workspaceId?: string;
  kiroMetadata?: { authMethod: "social" | "external_idp"; profileArn?: string; region?: string };
  promptqlProjectId?: string;
};

export class ImportCredentialConflict extends Error {}

/** Caller must supply a synchronous, throwing audit writer using this same DB.
 * A best-effort logger which swallows failures cannot satisfy this contract. */
export function saveImportedCredential(db: SqliteAdapter, input: ImportedCredential,
  audit: (db: SqliteAdapter, id: string, provider: string) => void): { id: string; created: boolean } {
  if (!hasCurrentEncryptionKey()) throw new Error("Secure import unavailable");
  const identity = input.refresh || input.access;
  if (!identity || !input.provider || (input.authType === "apikey" && input.refresh)) throw new Error("Invalid import");
  const key = createHmac("sha256", process.env.STORAGE_ENCRYPTION_KEY!)
    .update(JSON.stringify(["styx-import-v1", input.provider, input.authType, input.refresh ? "refresh" : "access", identity])).digest("hex");
  let result: { id: string; created: boolean } | undefined;
  db.immediate(() => {
    const marker = db.prepare("SELECT value FROM key_value WHERE namespace = ? AND key = ?").get("token_import_v1", key) as { value: string } | undefined;
    // Always scan both token types, even on a marker hit: old markers survive
    // rotation and existing OAuth/import rows may independently match either token.
    const rows = db.prepare("SELECT id, access_token, refresh_token, api_key, provider_specific_data FROM provider_connections WHERE provider = ? AND auth_type = ?").all(input.provider, input.authType) as Array<Record<string, unknown>>;
    const matches: Array<{ row: Record<string, unknown>; access: boolean; refresh: boolean; marked: boolean }> = [];
    for (const row of rows) {
      const read = (stored: unknown) => {
        if (stored == null || stored === "") return null;
        if (typeof stored !== "string") throw new Error("Secure import unavailable");
        const plain = decrypt(stored, { quiet: true });
        if (plain == null) throw new Error("Secure import unavailable");
        return plain;
      };
      const access = read(input.authType === "apikey" ? row.api_key : row.access_token) === input.access;
      const refresh = input.authType === "oauth" ? read(row.refresh_token) : null;
      const refreshMatch = !!input.refresh && refresh === input.refresh;
      const marked = marker?.value === row.id;
      if (access || refreshMatch || marked) matches.push({ row, access, refresh: refreshMatch, marked });
      // A matching access paired with a different or absent refresh is not an
      // authorization to attach or replace a refresh token.
      if (input.refresh && access && !refreshMatch && !marked) throw new ImportCredentialConflict("Conflicting import credentials");
    }
    if (marker && !rows.some(row => row.id === marker.value)) {
      const target = db.prepare("SELECT id FROM provider_connections WHERE id = ?").get(marker.value);
      if (target) throw new Error("Conflicting import binding");
      db.prepare("DELETE FROM key_value WHERE namespace = ? AND key = ?").run("token_import_v1", key);
    }
    if (matches.length > 1) throw new ImportCredentialConflict("Conflicting import credentials");
    if (matches.length === 1) {
      const { row } = matches[0];
      if (input.authType === "oauth") {
        let metadata: any;
        try { metadata = JSON.parse(String(row.provider_specific_data || "{}")); } catch { throw new ImportCredentialConflict("Conflicting import credentials"); }
        if (metadata?.importedToken !== true || metadata?.nonRefreshable !== true || (input.refresh && metadata?.autoRefreshDisabled !== true)) throw new ImportCredentialConflict("Conflicting import credentials");
      }
      if (input.provider === "codex" || input.provider === "kiro" || input.provider === "promptql") {
        let metadata: any;
        try { metadata = JSON.parse(String(row.provider_specific_data || "{}")); } catch { throw new Error("Secure import unavailable"); }
        if (input.provider === "codex" && (metadata?.workspaceId || undefined) !== input.workspaceId) throw new Error("Conflicting import binding");
        if (input.provider === "kiro" && ["authMethod", "profileArn", "region"].some(k => (metadata?.[k] || undefined) !== (input.kiroMetadata as any)?.[k])) throw new ImportCredentialConflict("Conflicting import binding");
        if (input.provider === "promptql" && metadata?.projectId !== input.promptqlProjectId) throw new ImportCredentialConflict("Conflicting import binding");
      }
      const id = String(row.id);
      if (!marker || marker.value !== id) db.prepare("INSERT INTO key_value (namespace, key, value) VALUES (?, ?, ?)").run("token_import_v1", key, id);
      result = { id, created: false }; return;
    }
    const secure = (value: string) => {
      if (!hasCurrentEncryptionKey()) throw new Error("Secure import unavailable");
      const cipher = encrypt(value);
      if (typeof cipher !== "string" || !cipher.startsWith("enc:v1:") || decrypt(cipher, { quiet: true }) !== value) throw new Error("Secure import unavailable");
      return cipher;
    };
    const access = secure(input.access), refresh = input.refresh ? secure(input.refresh) : null;
    const id = randomUUID(), now = new Date().toISOString();
    const metadata = { importedToken: true, nonRefreshable: true, ...(refresh ? { autoRefreshDisabled: true } : {}), ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}), ...(input.provider === "kiro" ? input.kiroMetadata : {}), ...(input.provider === "promptql" ? {projectId: input.promptqlProjectId} : {}), ...(input.provider === "codex" ? { codexFingerprintSeed: randomUUID() } : {}) };
    const priority = (db.prepare("SELECT COALESCE(MAX(priority), 0) + 1 AS priority FROM provider_connections WHERE provider = ?").get(input.provider) as { priority: number }).priority;
    db.prepare(`INSERT INTO provider_connections (id, provider, auth_type, name, priority, is_active, access_token, refresh_token, api_key, expires_at, token_expires_at, provider_specific_data, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, input.provider, input.authType, input.name, priority, input.authType === "oauth" ? access : null, refresh, input.authType === "apikey" ? access : null, input.expiresAt, input.expiresAt, JSON.stringify(metadata), now, now);
    db.prepare("INSERT INTO key_value (namespace, key, value) VALUES (?, ?, ?)").run("token_import_v1", key, id);
    const auditResult: unknown = audit(db, id, input.provider);
    if (auditResult && typeof (auditResult as { then?: unknown }).then === "function") throw new Error("Audit must be synchronous");
    result = { id, created: true };
  });
  if (!result) throw new Error("Secure import unavailable");
  if (result.created) invalidateDbCache("connections");
  return result;
}

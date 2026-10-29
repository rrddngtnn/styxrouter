// Isolated proof only. All CBCN exchanges must use this boundary before it can
// provide a system-wide fence; no production caller imports this module.
import { createHmac, randomUUID } from "node:crypto";
import type { SqliteAdapter } from "../../src/lib/db/adapters/types";
import { decrypt, encrypt, hasCurrentEncryptionKey } from "../../src/lib/db/encryption";

export type Rotation = { accessToken: string; refreshToken: string; expiresIn?: number };
export type Context = { db: SqliteAdapter; connectionId: string };
type Options = { allowImported?: boolean };
const denied = () => new Error("Refresh unavailable; re-authenticate the connection");
const namespace = "imported_refresh_claim_v1";

function validateContext(context: Context, expected: string, options: Options) {
  const { db, connectionId } = context;
  if (!connectionId || !expected || !hasCurrentEncryptionKey() || db.driver === "sql.js" || !db.name || db.name === ":memory:" || db.inTransaction) throw denied();
  const synchronous = Number(db.pragma("synchronous", {simple:true}));
  if (!Number.isFinite(synchronous) || synchronous < 2) throw denied();
  const checkRow = () => {
    const row = db.prepare("SELECT provider, refresh_token, provider_specific_data FROM provider_connections WHERE id = ?").get(connectionId) as {provider:string; refresh_token:string; provider_specific_data:string} | undefined;
    let metadata: any;
    try { metadata = JSON.parse(row?.provider_specific_data || "{}"); } catch { throw denied(); }
    if ((options.allowImported === false && metadata?.importedToken === true) || row?.provider !== "codebuddy-cn" || !row.refresh_token?.startsWith("enc:v1:") || decrypt(row.refresh_token, {quiet:true}) !== expected) throw denied();
  };
  const key = createHmac("sha256", process.env.STORAGE_ENCRYPTION_KEY!).update("styx-imported-refresh-claim-v1\0codebuddy-cn\0").update(expected).digest("hex");
  return { db, connectionId, key, checkRow };
}

export function claimRefresh(context: Context, expected: string, options: Options = {}): string {
  const { db, key, checkRow } = validateContext(context, expected, options);
  const owner = randomUUID();
  db.immediate(() => {
    checkRow();
    db.exec("CREATE TABLE IF NOT EXISTS imported_refresh_used_v1 (key TEXT PRIMARY KEY NOT NULL)");
    if (db.prepare("SELECT key FROM imported_refresh_used_v1 WHERE key = ?").get(key) || db.prepare("SELECT value FROM key_value WHERE namespace = ? AND key = ?").get(namespace,key)) throw denied();
    db.prepare("INSERT INTO key_value (namespace,key,value) VALUES (?,?,?)").run(namespace,key,owner);
  });
  return owner;
}

export function finishRefresh(context: Context, expected: string, owner: string, result: Rotation, options: Options = {}): void {
  const { db, connectionId, key, checkRow } = validateContext(context, expected, options);
  if (!owner || !result || typeof result.accessToken !== "string" || !result.accessToken || typeof result.refreshToken !== "string" || !result.refreshToken || result.refreshToken === expected || (result.expiresIn != null && (!Number.isFinite(result.expiresIn) || result.expiresIn <= 0))) throw denied();
  const expires = result.expiresIn == null ? null : new Date(Date.now() + result.expiresIn * 1000).toISOString();
  db.immediate(() => {
    checkRow();
    const claim = db.prepare("SELECT value FROM key_value WHERE namespace = ? AND key = ?").get(namespace,key) as {value:string} | undefined;
    if (claim?.value !== owner || !hasCurrentEncryptionKey()) throw denied();
    const secure = (value:string) => { const cipher = encrypt(value); if (!cipher?.startsWith("enc:v1:") || decrypt(cipher,{quiet:true}) !== value) throw denied(); return cipher; };
    if (db.prepare("UPDATE provider_connections SET access_token = ?, refresh_token = ?, expires_at = ?, token_expires_at = ?, updated_at = ? WHERE id = ?").run(secure(result.accessToken),secure(result.refreshToken),expires,expires,new Date().toISOString(),connectionId).changes !== 1) throw denied();
    db.prepare("INSERT INTO config_audit_log (id,timestamp,action,target,target_id,target_name,before_json,after_json,diff_json,source,note) VALUES (?,?,?,?,?,?,NULL,NULL,?,?,NULL)").run(randomUUID(),new Date().toISOString(),"cbcn_refresh","provider_connection",connectionId,"","{}","system");
    db.prepare("INSERT INTO imported_refresh_used_v1 (key) VALUES (?)").run(key);
    if (db.prepare("DELETE FROM key_value WHERE namespace = ? AND key = ? AND value = ?").run(namespace,key,owner).changes !== 1) throw denied();
  });
}

export async function refreshWithContext(context: Context, expected: string, exchange: (token: string) => Promise<Rotation>, options: Options = {}): Promise<Rotation> {
  try {
    const owner = claimRefresh(context, expected, options);
    // Any error or ambiguous response deliberately leaves the claim held.
    const result = await exchange(expected);
    finishRefresh(context, expected, owner, result, options);
    return result;
  } catch {
    throw denied();
  }
}

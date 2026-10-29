import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createBunSqliteAdapter } from "../../src/lib/db/adapters/bunSqliteAdapter";
import { encrypt, decrypt } from "../../src/lib/db/encryption";
import { refreshWithContext } from "./fence";

test("persistence errors are sanitized and preserve the claim and original pair", async () => {
  process.env.STORAGE_ENCRYPTION_KEY = "synthetic-fence-redaction";
  const dir = mkdtempSync(join(process.env.TMPDIR!, "cbcn-fence-redaction-"));
  const path = join(dir, "db.sqlite");
  const raw = new Database(path);
  try {
    raw.exec(`PRAGMA synchronous=FULL; CREATE TABLE key_value (namespace TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(namespace,key)); CREATE TABLE provider_connections (id TEXT PRIMARY KEY, provider TEXT, access_token TEXT, refresh_token TEXT, provider_specific_data TEXT, expires_at TEXT, token_expires_at TEXT, updated_at TEXT); CREATE TABLE config_audit_log (id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, target_id TEXT NOT NULL, target_name TEXT NOT NULL, before_json TEXT, after_json TEXT, diff_json TEXT NOT NULL, source TEXT NOT NULL, note TEXT); CREATE TRIGGER reject_audit BEFORE INSERT ON config_audit_log BEGIN SELECT RAISE(ABORT, 'synthetic-secret-in-db-error'); END;`);
    raw.query("INSERT INTO provider_connections VALUES ('id', 'codebuddy-cn', ?, ?, '{}', NULL, NULL, '')").run(encrypt("old-access"), encrypt("old-refresh"));
    const context = { db: createBunSqliteAdapter(raw as any, path), connectionId: "id" };
    let message = "";
    try { await refreshWithContext(context, "old-refresh", async () => ({ accessToken: "new-access", refreshToken: "new-refresh" })); } catch (error) { message = String(error); }
    expect(message).toContain("Refresh unavailable; re-authenticate the connection");
    expect(message).not.toContain("synthetic-secret-in-db-error");
    const row: any = raw.query("SELECT access_token, refresh_token FROM provider_connections WHERE id='id'").get();
    expect(decrypt(row.access_token)).toBe("old-access");
    expect(decrypt(row.refresh_token)).toBe("old-refresh");
    expect(raw.query("SELECT count(*) AS n FROM key_value").get()).toEqual({ n: 1 });
  } finally { raw.close(); rmSync(dir, { recursive: true, force: true }); }
});

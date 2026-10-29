import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createBunSqliteAdapter } from "../src/lib/db/adapters/bunSqliteAdapter";
import { claimImportedRefresh, finishImportedRefresh } from "../src/lib/db/importedRefreshClaim";
import { encrypt, decrypt } from "../src/lib/db/encryption";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

process.env.STORAGE_ENCRYPTION_KEY = "synthetic-claim-test-key";
test("claims persist until an encrypted atomic update succeeds", () => {
  const dir = mkdtempSync(join(process.env.TMPDIR!, "claim-test-"));
  const path = join(dir, "test.sqlite");
  const raw = new Database(path);
  const db = createBunSqliteAdapter(raw as any, path);
  try {
    raw.exec(`CREATE TABLE config_audit_log (id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, target_id TEXT NOT NULL, target_name TEXT NOT NULL, before_json TEXT, after_json TEXT, diff_json TEXT NOT NULL, source TEXT NOT NULL, note TEXT); CREATE TABLE key_value (namespace TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(namespace,key)); CREATE TABLE provider_connections (id TEXT PRIMARY KEY, access_token TEXT, refresh_token TEXT, provider_specific_data TEXT, expires_at TEXT, token_expires_at TEXT, updated_at TEXT);`);
    raw.query("INSERT INTO provider_connections VALUES (?, ?, ?, ?, NULL, NULL, '')").run("id", encrypt("old-access"), encrypt("old-refresh"), JSON.stringify({importedToken:true}));
    const token = claimImportedRefresh(db, "id", "old-refresh");
    expect(() => claimImportedRefresh(db, "id", "old-refresh")).toThrow(/re-authenticate/);
    expect(() => finishImportedRefresh(db, "id", "wrong", "old-refresh", "new-access", "new-refresh", null)).toThrow();
    expect(raw.query("SELECT count(*) AS n FROM key_value").get()).toEqual({n:1});
    const stored = JSON.stringify(raw.query("SELECT * FROM key_value").all());
    expect(stored).not.toContain("old-refresh");
    expect(stored).not.toContain(process.env.STORAGE_ENCRYPTION_KEY!);
    expect(stored).not.toContain("old-access");
    finishImportedRefresh(db, "id", token, "old-refresh", "new-access", "new-refresh", null);
    const row:any = raw.query("SELECT access_token, refresh_token FROM provider_connections").get();
    expect(row.access_token).toStartWith("enc:v1:");
    expect(row.refresh_token).toStartWith("enc:v1:");
    expect(decrypt(row.access_token)).toBe("new-access");
    expect(decrypt(row.refresh_token)).toBe("new-refresh");
    expect(raw.query("SELECT count(*) AS n FROM key_value").get()).toEqual({n:0});
  } finally { raw.close(); rmSync(dir, {recursive:true, force:true}); }
});

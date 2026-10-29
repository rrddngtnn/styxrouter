import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createBunSqliteAdapter } from "../src/lib/db/adapters/bunSqliteAdapter";
import { claimImportedRefresh, finishImportedRefresh } from "../src/lib/db/importedRefreshClaim";
import { encrypt, decrypt } from "../src/lib/db/encryption";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

process.env.STORAGE_ENCRYPTION_KEY = "synthetic-audit-key";
test("rotation and sanitized audit commit together; rejected audit retains claim and old pair", () => {
 const dir = mkdtempSync(join(process.env.TMPDIR!, "refresh-audit-")); const path = join(dir,"test.sqlite");
 const raw = new Database(path); const db = createBunSqliteAdapter(raw as any,path);
 try {
  raw.exec(`CREATE TABLE key_value (namespace TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(namespace,key)); CREATE TABLE provider_connections (id TEXT PRIMARY KEY, provider TEXT, access_token TEXT, refresh_token TEXT, provider_specific_data TEXT, expires_at TEXT, token_expires_at TEXT, updated_at TEXT); CREATE TABLE config_audit_log (id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, target_id TEXT NOT NULL, target_name TEXT NOT NULL, before_json TEXT, after_json TEXT, diff_json TEXT NOT NULL, source TEXT NOT NULL, note TEXT);`);
  raw.query("INSERT INTO provider_connections VALUES (?, ?, ?, ?, ?, NULL, NULL, '')").run("id", "codebuddy-cn", encrypt("old-access-secret"), encrypt("old-refresh-secret"), JSON.stringify({importedToken:true}));
  const claim = claimImportedRefresh(db,"id","old-refresh-secret","codebuddy-cn");
  raw.exec("CREATE TRIGGER reject_audit BEFORE INSERT ON config_audit_log BEGIN SELECT RAISE(ABORT, 'rejected'); END");
  expect(() => finishImportedRefresh(db,"id",claim,"old-refresh-secret","new-access-secret","new-refresh-secret",null,"codebuddy-cn")).toThrow();
  let row:any = raw.query("SELECT access_token, refresh_token FROM provider_connections").get();
  expect(decrypt(row.access_token)).toBe("old-access-secret"); expect(decrypt(row.refresh_token)).toBe("old-refresh-secret");
  expect(raw.query("SELECT count(*) AS n FROM key_value").get()).toEqual({n:1});
  raw.exec("DROP TRIGGER reject_audit");
  finishImportedRefresh(db,"id",claim,"old-refresh-secret","new-access-secret","new-refresh-secret",null,"codebuddy-cn");
  row = raw.query("SELECT access_token, refresh_token FROM provider_connections").get();
  expect(decrypt(row.refresh_token)).toBe("new-refresh-secret");
  const audit = raw.query("SELECT * FROM config_audit_log").all(); expect(audit).toHaveLength(1);
  expect(JSON.stringify(audit)).not.toContain("secret"); expect(raw.query("SELECT count(*) AS n FROM key_value").get()).toEqual({n:0});
 } finally { raw.close(); rmSync(dir,{recursive:true,force:true}); }
});
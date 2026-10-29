import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createBunSqliteAdapter } from "../src/lib/db/adapters/bunSqliteAdapter";
import { encrypt, decrypt } from "../src/lib/db/encryption";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

process.env.STORAGE_ENCRYPTION_KEY = "synthetic-orchestrator-key";

test("CBCN orchestrator claims before upstream and publishes only committed encrypted rotation", async () => {
  const { refreshImportedCodebuddyCn } = await import("../src/lib/db/importedRefreshOrchestrator");
  const dir = mkdtempSync(join(process.env.TMPDIR!, "orchestrator-"));
  const path = join(dir, "db.sqlite"); const raw = new Database(path); const db = createBunSqliteAdapter(raw as any, path);
  try {
    raw.exec("CREATE TABLE config_audit_log (id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, target_id TEXT NOT NULL, target_name TEXT NOT NULL, before_json TEXT, after_json TEXT, diff_json TEXT NOT NULL, source TEXT NOT NULL, note TEXT); CREATE TABLE key_value (namespace TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(namespace,key)); CREATE TABLE provider_connections (id TEXT PRIMARY KEY, provider TEXT, access_token TEXT, refresh_token TEXT, provider_specific_data TEXT, expires_at TEXT, token_expires_at TEXT, updated_at TEXT)");
    raw.query("INSERT INTO provider_connections VALUES (?, ?, ?, ?, ?, NULL, NULL, '')").run("id", "codebuddy-cn", encrypt("old-access"), encrypt("old-refresh"), JSON.stringify({importedToken:true, autoRefreshDisabled:true}));
    raw.query("INSERT INTO provider_connections VALUES (?, ?, ?, ?, ?, NULL, NULL, '')").run("duplicate", "codebuddy-cn", encrypt("old-access"), encrypt("old-refresh"), JSON.stringify({importedToken:true, autoRefreshDisabled:true}));
    const out = await refreshImportedCodebuddyCn(db, "id", "old-refresh", async () => {
      expect(raw.query("SELECT count(*) AS n FROM key_value").get()).toEqual({n:1});
      return {accessToken:"new-access", refreshToken:"new-refresh", expiresIn:3600};
    });
    const row:any = raw.query("SELECT * FROM provider_connections WHERE id = 'id'").get();
    expect(out.accessToken).toBe("new-access"); expect(decrypt(row.access_token)).toBe("new-access"); expect(decrypt(row.refresh_token)).toBe("new-refresh");
    expect(row.access_token).toStartWith("enc:v1:"); expect(row.refresh_token).toStartWith("enc:v1:");
    expect(raw.query("SELECT count(*) AS n FROM key_value").get()).toEqual({n:0});
    let replayCalls = 0;
    await expect(refreshImportedCodebuddyCn(db, "duplicate", "old-refresh", async () => { replayCalls++; return null; })).rejects.toThrow(/re-authenticate/);
    expect(replayCalls).toBe(0);
    let error = "";
    try { await refreshImportedCodebuddyCn(db, "id", "new-refresh", async () => { throw new Error("synthetic-secret-upstream"); }); } catch (e) { error = String(e); }
    expect(error).toContain("re-authenticate"); expect(error).not.toContain("synthetic-secret-upstream");
    expect(raw.query("SELECT count(*) AS n FROM key_value").get()).toEqual({n:1});
    let calls = 0;
    await expect(refreshImportedCodebuddyCn(db, "id", "new-refresh", async () => { calls++; return null; })).rejects.toThrow(/re-authenticate/);
    expect(calls).toBe(0);
    const after:any = raw.query("SELECT access_token, refresh_token FROM provider_connections WHERE id = 'id'").get();
    expect(decrypt(after.access_token)).toBe("new-access"); expect(decrypt(after.refresh_token)).toBe("new-refresh");
  } finally { raw.close(); rmSync(dir,{recursive:true,force:true}); }
});

import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { encrypt, decrypt } from "../../src/lib/db/encryption";
import { createBunSqliteAdapter } from "../../src/lib/db/adapters/bunSqliteAdapter";
import { refreshWithContext } from "../../src/lib/db/codebuddyRefreshFence";
import * as fence from "../../src/lib/db/codebuddyRefreshFence";

process.env.STORAGE_ENCRYPTION_KEY = "synthetic-fence-key";

test("exposes reusable claim and finish operations", () => {
  expect(typeof (fence as any).claimRefresh).toBe("function");
  expect(typeof (fence as any).finishRefresh).toBe("function");
});

test("finish rejects stale owner, unchanged refresh and audit failure without releasing claim", () => {
  const dir = mkdtempSync(join(process.env.TMPDIR!, "cbcn-fence-atomic-"));
  const path = join(dir, "db.sqlite");
  const raw = new Database(path);
  try {
    raw.exec(`PRAGMA synchronous=FULL; CREATE TABLE key_value (namespace TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(namespace,key)); CREATE TABLE provider_connections (id TEXT PRIMARY KEY, provider TEXT, access_token TEXT, refresh_token TEXT, provider_specific_data TEXT, expires_at TEXT, token_expires_at TEXT, updated_at TEXT); CREATE TABLE config_audit_log (id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, target_id TEXT NOT NULL, target_name TEXT NOT NULL, before_json TEXT, after_json TEXT, diff_json TEXT NOT NULL, source TEXT NOT NULL, note TEXT); CREATE TRIGGER reject_audit BEFORE INSERT ON config_audit_log BEGIN SELECT RAISE(ABORT, 'rejected'); END;`);
    raw.query("INSERT INTO provider_connections VALUES ('first', 'codebuddy-cn', ?, ?, '{}', NULL, NULL, '')").run(encrypt("old-access"), encrypt("old-refresh"));
    const context = { db: createBunSqliteAdapter(raw as any, path), connectionId: "first" };
    const owner = fence.claimRefresh(context, "old-refresh");
    const result = { accessToken: "new-access", refreshToken: "new-refresh" };
    expect(() => fence.finishRefresh(context, "old-refresh", "wrong", result)).toThrow();
    expect(() => fence.finishRefresh(context, "old-refresh", owner, { ...result, refreshToken: "old-refresh" })).toThrow();
    expect(() => fence.finishRefresh(context, "old-refresh", owner, result)).toThrow();
    const row: any = raw.query("SELECT access_token, refresh_token FROM provider_connections WHERE id='first'").get();
    expect(decrypt(row.access_token)).toBe("old-access");
    expect(decrypt(row.refresh_token)).toBe("old-refresh");
    expect(raw.query("SELECT count(*) AS n FROM key_value").get()).toEqual({ n: 1 });
    expect(raw.query("SELECT count(*) AS n FROM imported_refresh_used_v1").get()).toEqual({ n: 0 });
  } finally { raw.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("exchange failures do not expose secrets and retain the claim", async () => {
  const dir = mkdtempSync(join(process.env.TMPDIR!, "cbcn-fence-error-"));
  const path = join(dir, "db.sqlite");
  const raw = new Database(path);
  try {
    raw.exec(`PRAGMA synchronous=FULL; CREATE TABLE key_value (namespace TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(namespace,key)); CREATE TABLE provider_connections (id TEXT PRIMARY KEY, provider TEXT, access_token TEXT, refresh_token TEXT, provider_specific_data TEXT, expires_at TEXT, token_expires_at TEXT, updated_at TEXT);`);
    raw.query("INSERT INTO provider_connections VALUES ('first', 'codebuddy-cn', ?, ?, '{}', NULL, NULL, '')").run(encrypt("old-access"), encrypt("old-refresh"));
    const context = { db: createBunSqliteAdapter(raw as any, path), connectionId: "first" };
    let calls = 0;
    const exchange = async () => { calls++; throw new Error("secret-from-upstream"); };
    await expect(refreshWithContext(context, "old-refresh", exchange)).rejects.toThrow("Refresh unavailable; re-authenticate the connection");
    await expect(refreshWithContext(context, "old-refresh", exchange)).rejects.toThrow();
    expect(calls).toBe(1);
    expect(raw.query("SELECT count(*) AS n FROM key_value").get()).toEqual({ n: 1 });
  } finally { raw.close(); rmSync(dir, { recursive: true, force: true }); }
});
for (const kind of ["imported", "ordinary"]) for (const firstMode of ["raw", "generic"]) test(kind === "imported" ? `imported ${firstMode} and alternate path deny before exchange` : `two processes fence ordinary ${firstMode} vs alternate path and preserve stale-token marker`, async () => {
  const dir = mkdtempSync(join(process.env.TMPDIR!, "cbcn-fence-"));
  const path = join(dir, "db.sqlite");
  const db = new Database(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE key_value (namespace TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(namespace,key)); CREATE TABLE provider_connections (id TEXT PRIMARY KEY, provider TEXT, access_token TEXT, refresh_token TEXT, provider_specific_data TEXT, expires_at TEXT, token_expires_at TEXT, updated_at TEXT); CREATE TABLE config_audit_log (id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, target_id TEXT NOT NULL, target_name TEXT NOT NULL, before_json TEXT, after_json TEXT, diff_json TEXT NOT NULL, source TEXT NOT NULL, note TEXT);`);
  for (const id of ["first", "duplicate"]) db.query("INSERT INTO provider_connections VALUES (?, 'codebuddy-cn', ?, ?, ?, NULL, NULL, '')").run(id, encrypt("old-access"), encrypt("old-refresh"), JSON.stringify({importedToken:kind === "imported"}));
  let count = 0; let release!: () => void; let seen!: () => void;
  const gate = new Promise<void>(r => release = r), arrived = new Promise<void>(r => seen = r);
  const server = Bun.serve({hostname:"127.0.0.1",port:0, async fetch(request) { count++; const body = await request.text(); const isRaw = request.headers.get("X-Refresh-Token") === "old-refresh"; expect(isRaw || new URLSearchParams(body).get("refresh_token") === "old-refresh").toBe(true); seen(); await gate; return isRaw ? Response.json({code:0,data:{accessToken:"new-access",refreshToken:"new-refresh",expiresIn:60}}) : Response.json({access_token:"new-access",refresh_token:"new-refresh",expires_in:60}); }});
  const spawn = (id: string, mode = "generic") => Bun.spawn([process.execPath, join(import.meta.dir,"worker.ts"), path, `http://127.0.0.1:${server.port}`, id, mode], {stdout:"pipe",stderr:"pipe",env:{...process.env, STORAGE_ENCRYPTION_KEY:"synthetic-fence-key"}});
  let first: ReturnType<typeof spawn> | undefined;
  try {
    first = spawn("first", firstMode);
    if (kind === "imported") {
      const before = db.query("SELECT access_token, refresh_token, provider_specific_data FROM provider_connections ORDER BY id").all();
      const out = await new Response(first.stdout).text();
      const err = await new Response(first.stderr).text();
      expect(await first.exited).toBe(0);
      expect(out).toContain("DENIED");
      expect(out + err).not.toContain("old-refresh");
      const alternate = spawn("duplicate", firstMode === "raw" ? "generic" : "raw");
      const alternateOut = await new Response(alternate.stdout).text();
      const alternateErr = await new Response(alternate.stderr).text();
      expect(await alternate.exited).toBe(0);
      expect(alternateOut).toContain("DENIED");
      expect(alternateOut + alternateErr).not.toContain("old-refresh");
      expect(count).toBe(0);
      expect(db.query("SELECT access_token, refresh_token, provider_specific_data FROM provider_connections ORDER BY id").all()).toEqual(before);
      expect(db.query("SELECT count(*) AS n FROM key_value").get()).toEqual({ n: 0 });
      return;
    }
    await Promise.race([arrived, new Promise((_,reject) => setTimeout(() => reject(new Error("first request not received")), 5000))]);
    for (const id of ["duplicate", "", "missing"]) {
      const p = spawn(id, firstMode === "raw" ? "generic" : "raw"); const out = await new Response(p.stdout).text(); const err = await new Response(p.stderr).text();
      expect(await p.exited).toBe(0); expect(out).toContain("DENIED"); expect(out + err).not.toContain("old-refresh"); expect(count).toBe(1);
    }
    release(); expect(await new Response(first.stdout).text()).toContain("SUCCESS"); expect(await first.exited).toBe(0);
    const row:any = db.query("SELECT refresh_token FROM provider_connections WHERE id='first'").get(); expect(decrypt(row.refresh_token)).toBe("new-refresh");
    const stale = spawn("duplicate"); expect(await new Response(stale.stdout).text()).toContain("DENIED"); expect(await stale.exited).toBe(0); expect(count).toBe(1);
  } finally { release(); first?.kill(); if (first) await first.exited; server.stop(true); db.close(); rmSync(dir,{recursive:true,force:true}); }
}, 15000);

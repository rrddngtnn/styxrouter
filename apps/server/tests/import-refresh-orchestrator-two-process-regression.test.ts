import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { encrypt, decrypt } from "../src/lib/db/encryption";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

process.env.STORAGE_ENCRYPTION_KEY = "synthetic-orchestrator-key";
const worker = join(import.meta.dir, "helpers/import-refresh-worker.ts");
const oldRefresh = "synthetic-old-refresh";
const newRefresh = "synthetic-new-refresh";

async function waitFor(reader: ReadableStreamDefaultReader<Uint8Array>, needle: string) {
  let text = "";
  const deadline = setTimeout(() => reader.cancel(), 5000);
  try {
    while (!text.includes(needle)) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error(`worker ended before ${needle}: ${text}`);
      text += new TextDecoder().decode(chunk.value);
    }
    return text;
  } finally { clearTimeout(deadline); }
}

for (const scenario of ["success", "missing-token", "duplicate", "raw", "raw-forged-flag", "generic", "before", "after", "persistence"] as const) {
  test(`two processes: ${scenario} retains exclusive claim and rejects stale refresh`, async () => {
    const dir = mkdtempSync(join(process.env.TMPDIR!, "refresh-two-"));
    const path = join(dir, "db.sqlite");
    const raw = new Database(path);
    raw.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE config_audit_log (id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, target_id TEXT NOT NULL, target_name TEXT NOT NULL, before_json TEXT, after_json TEXT, diff_json TEXT NOT NULL, source TEXT NOT NULL, note TEXT); CREATE TABLE key_value (namespace TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(namespace,key)); CREATE TABLE provider_connections (id TEXT PRIMARY KEY, provider TEXT, access_token TEXT, refresh_token TEXT, provider_specific_data TEXT, expires_at TEXT, token_expires_at TEXT, updated_at TEXT);`);
    raw.query("INSERT INTO provider_connections VALUES (?, ?, ?, ?, ?, NULL, NULL, '')").run("id", "codebuddy-cn", encrypt("synthetic-old-access"), encrypt(oldRefresh), JSON.stringify({importedToken:true, autoRefreshDisabled:true}));
    if (scenario === "duplicate" || scenario === "success") raw.query("INSERT INTO provider_connections VALUES (?, ?, ?, ?, ?, NULL, NULL, '')").run("id2", "codebuddy-cn", encrypt("synthetic-old-access"), encrypt(oldRefresh), JSON.stringify({importedToken:true, autoRefreshDisabled:true}));
    let calls = 0, badRequest = false;
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    let received!: () => void;
    const requestSeen = new Promise<void>(r => { received = r; });
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
      calls++;
      badRequest ||= req.method !== "POST" || req.headers.get("x-refresh-token") !== oldRefresh || await req.text() !== "{}";
      received();
      if (["success", "duplicate", "raw", "raw-forged-flag", "generic"].includes(scenario) && calls === 1) await gate;
      return Response.json({code:0, data:{accessToken:"synthetic-new-access", ...(scenario === "missing-token" ? {} : {refreshToken:newRefresh}), expiresIn:3600}});
    }});
    const spawn = (mode: string) => Bun.spawn([process.execPath, worker, path, `http://127.0.0.1:${server.port}/refresh`, mode], { stdout:"pipe", stderr:"pipe", env: {...process.env, STORAGE_ENCRYPTION_KEY:"synthetic-orchestrator-key"} });
    let first: ReturnType<typeof spawn> | undefined, second: ReturnType<typeof spawn> | undefined;
    try {
      first = spawn(scenario === "duplicate" || scenario === "raw" || scenario === "raw-forged-flag" || scenario === "generic" ? "success" : scenario); const reader = first.stdout.getReader();
      await waitFor(reader, "CLAIMED");
      if (scenario !== "before") await requestSeen;
      if (scenario === "after") await waitFor(reader, "RECEIVED");
      if (scenario === "persistence") await waitFor(reader, "PERSISTING");
      if (scenario === "duplicate" || scenario === "raw" || scenario === "raw-forged-flag" || scenario === "generic") { /* retain first claim while the second process runs */ }
      else if (scenario === "missing-token") { await waitFor(reader, "DENIED"); expect(await first.exited).toBe(0); }
      else if (scenario !== "success") { first.kill("SIGKILL"); await first.exited; }
      second = spawn(scenario === "duplicate" || scenario === "raw" || scenario === "raw-forged-flag" || scenario === "generic" ? scenario : scenario === "success" ? "success" : "future");
      const output = await new Response(second.stdout).text();
      const errors = await new Response(second.stderr).text();
      expect(await second.exited).toBe(0);
      expect(output).toContain("DENIED");
      expect(output + errors).not.toContain(oldRefresh);
      expect(output + errors).not.toContain(newRefresh);
      expect(calls).toBe(scenario === "before" ? 0 : 1);
      expect(badRequest).toBe(false);
      if (scenario === "success") {
        release(); await waitFor(reader, "SUCCESS"); expect(await first.exited).toBe(0);
        const row:any = raw.query("SELECT access_token, refresh_token FROM provider_connections WHERE id='id'").get();
        expect(row.access_token).toStartWith("enc:v1:"); expect(row.refresh_token).toStartWith("enc:v1:");
        expect(decrypt(row.access_token)).toBe("synthetic-new-access"); expect(decrypt(row.refresh_token)).toBe(newRefresh);
        expect(raw.query("SELECT count(*) AS n FROM key_value").get()).toEqual({n:0});
        const stale = spawn("duplicate");
        const staleOutput = await new Response(stale.stdout).text();
        const staleErrors = await new Response(stale.stderr).text();
        expect(await stale.exited).toBe(0);
        expect(staleOutput).toContain("DENIED");
        expect(staleOutput + staleErrors).not.toContain(oldRefresh);
        expect(staleOutput + staleErrors).not.toContain(newRefresh);
        expect(calls).toBe(1);
        const staleOriginal = spawn("success");
        const originalOutput = await new Response(staleOriginal.stdout).text();
        const originalErrors = await new Response(staleOriginal.stderr).text();
        expect(await staleOriginal.exited).toBe(0);
        expect(originalOutput).toContain("DENIED");
        expect(originalOutput + originalErrors).not.toContain(oldRefresh);
        expect(originalOutput + originalErrors).not.toContain(newRefresh);
        expect(calls).toBe(1);
      } else {
        expect(raw.query("SELECT count(*) AS n FROM key_value").get()).toEqual({n:1});
        const row:any = raw.query("SELECT access_token, refresh_token FROM provider_connections WHERE id='id'").get();
        expect(decrypt(row.refresh_token)).toBe(oldRefresh); expect(decrypt(row.access_token)).toBe("synthetic-old-access");
      }
    } finally {
      release(); first?.kill(); second?.kill(); if (first) await first.exited; if (second) await second.exited;
      server.stop(true); raw.close(); rmSync(dir, {recursive:true,force:true});
    }
  }, 15000);
}

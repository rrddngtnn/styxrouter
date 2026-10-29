import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("different storage keys cannot race to create in the same empty webhook store", async () => {
  const dir = mkdtempSync(join(tmpdir(), "webhook-key-binding-"));
  const path = join(dir, "test.sqlite");
  const db = new Database(path);
  db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE webhooks (id TEXT PRIMARY KEY, url TEXT, events TEXT, secret TEXT, description TEXT, kind TEXT); CREATE TABLE webhook_provision_requests (request_key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, webhook_id TEXT NOT NULL); CREATE TABLE audit_log (timestamp TEXT, action TEXT, actor TEXT, target TEXT, resource_type TEXT, status TEXT);`);
  try {
    const workers = ["synthetic-key-one", "synthetic-key-two"].map((key, i) => Bun.spawn([process.execPath, join(import.meta.dir, "helpers/webhook-provision-worker.ts"), path, "create", `synthetic-request-key-000${i}`, "", ""], { stdin: "pipe", stdout: "pipe", stderr: "pipe", env: { ...process.env, STORAGE_ENCRYPTION_KEY: key } }));
    workers.forEach(p => p.stdin.end());
    const results = await Promise.all(workers.map(async p => { const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]); expect(code).toBe(0); expect(err).toBe(""); return JSON.parse(out); }));
    expect(results.map(x => x.status).sort()).toEqual(["created", "error"]);
    expect(db.query("SELECT count(*) n FROM webhooks").get()).toEqual({ n: 1 });
    expect(db.query("SELECT count(*) n FROM webhook_provision_requests").get()).toEqual({ n: 1 });
    expect(db.query("SELECT count(*) n FROM audit_log").get()).toEqual({ n: 1 });
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
}, 30000);

import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { decrypt } from "../src/lib/db/encryption";

test("two OS processes serialize create and rotation retries without redisclosing secrets", async () => {
  const dir = mkdtempSync(join(tmpdir(), "webhook-race-"));
  const path = join(dir, "test.sqlite");
  const key = "synthetic-process-encryption-key";
  process.env.STORAGE_ENCRYPTION_KEY = key;
  const db = new Database(path);
  db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE webhooks (id TEXT PRIMARY KEY, url TEXT, events TEXT, secret TEXT, description TEXT, kind TEXT); CREATE TABLE webhook_provision_requests (request_key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, webhook_id TEXT NOT NULL); CREATE TABLE audit_log (timestamp TEXT, action TEXT, actor TEXT, target TEXT, resource_type TEXT, status TEXT);`);
  async function race(operation: string, requestKey: string, id = "", version = "") {
    const ps = [0, 1].map(() => Bun.spawn([process.execPath, join(import.meta.dir, "helpers/webhook-provision-worker.ts"), path, operation, requestKey, id, version], { stdin: "pipe", stdout: "pipe", stderr: "pipe", env: { ...process.env, STORAGE_ENCRYPTION_KEY: key } }));
    for (const p of ps) p.stdin.end();
    return Promise.all(ps.map(async p => { const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]); expect(code).toBe(0); expect(err).toBe(""); return JSON.parse(out); }));
  }
  try {
    const created = await race("create", "synthetic-create-race-0001");
    expect(created.map(x => x.status).sort()).toEqual(["created", "replayed"]);
    expect(created[0].id).toBe(created[1].id);
    const firstSecret = created.find(x => x.secret).secret;
    const id = created[0].id;
    expect(db.query("SELECT count(*) n FROM webhooks").get()).toEqual({ n: 1 });
    expect(db.query("SELECT count(*) n FROM audit_log").get()).toEqual({ n: 1 });
    const rotated = await race("rotate", "synthetic-rotate-race-0001", id, created.find(x => x.secret).version);
    expect(rotated.map(x => x.status).sort()).toEqual(["replayed", "rotated"]);
    const secondSecret = rotated.find(x => x.secret).secret;
    expect(secondSecret).not.toBe(firstSecret);
    expect(rotated.find(x => x.status === "replayed").secret).toBeUndefined();
    const row: any = db.query("SELECT secret FROM webhooks WHERE id = ?").get(id);
    expect(row.secret).toStartWith("enc:v1:");
    expect(decrypt(row.secret, { quiet: true })).toBe(secondSecret);
    const audit = JSON.stringify(db.query("SELECT * FROM audit_log").all());
    expect(db.query("SELECT count(*) n FROM audit_log").get()).toEqual({ n: 2 });
    for (const secret of [firstSecret, secondSecret, "synthetic-url-token", "private-path"]) expect(audit).not.toContain(secret);
    expect(JSON.stringify(db.query("SELECT * FROM webhook_provision_requests").all())).not.toContain(firstSecret);
    db.exec("CREATE TRIGGER reject_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'synthetic-private-error'); END");
    const failed = await race("rotate", "synthetic-rotate-race-0002", id, rotated.find(x => x.secret).version);
    expect(failed).toEqual([{ status: "error" }, { status: "error" }]);
    expect((db.query("SELECT secret FROM webhooks WHERE id = ?").get(id) as any).secret).toBe(row.secret);
    expect(db.query("SELECT count(*) n FROM webhook_provision_requests").get()).toEqual({ n: 2 });
  } finally { db.close(); delete process.env.STORAGE_ENCRYPTION_KEY; rmSync(dir, { recursive: true, force: true }); }
}, 30000);

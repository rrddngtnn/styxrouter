import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SignJWT } from "jose";
import { decrypt } from "../src/lib/db/encryption";

test("two HTTP servers serialize create and rotate, enforce auth and redact responses and audit", async () => {
  const dir = mkdtempSync(join(tmpdir(), "webhook-http-race-"));
  const path = join(dir, "db.sqlite");
  const key = "synthetic-http-encryption-key";
  process.env.STORAGE_ENCRYPTION_KEY = key;
  const db = new Database(path);
  db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE webhooks (id TEXT PRIMARY KEY, url TEXT, events TEXT, secret TEXT, description TEXT, kind TEXT); CREATE TABLE webhook_provision_requests (request_key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, webhook_id TEXT NOT NULL); CREATE TABLE audit_log (timestamp TEXT, action TEXT, actor TEXT, target TEXT, resource_type TEXT, status TEXT);`);
  const workers = [0, 1].map(i => Bun.spawn([process.execPath, join(import.meta.dir, "helpers/webhook-http-worker.ts"), path, join(dir, `port${i}`)], { stdout: "ignore", stderr: "pipe", env: { ...process.env, DATA_DIR: join(dir, `worker${i}`), SQLITE_FILE: join(dir, `worker${i}`, "storage.sqlite"), JWT_SECRET: "synthetic-http-jwt", STORAGE_ENCRYPTION_KEY: key } }));
  try {
    const deadline = Date.now() + 15000;
    while (![0, 1].every(i => existsSync(join(dir, `port${i}`)))) {
      if (Date.now() > deadline || workers.some(p => p.exitCode !== null)) { for (const p of workers) p.kill(); throw new Error(`HTTP worker failed to start: ${(await Promise.all(workers.map(p => new Response(p.stderr).text()))).join(" | ")}`); }
      await Bun.sleep(20);
    }
    const ports = [0, 1].map(i => readFileSync(join(dir, `port${i}`), "utf8"));
    const token = await new SignJWT({ authenticated: true }).setProtectedHeader({ alg: "HS256" }).sign(new TextEncoder().encode("synthetic-http-jwt"));
    const body = JSON.stringify({ url: "https://dns.example/private-path?token=private-token", events: ["test.ping"] });
    const call = (i: number, endpoint: string, requestKey: string, extra: Record<string, string> = {}, data = body) => fetch(`http://127.0.0.1:${ports[i]}${endpoint}`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": requestKey, ...extra }, body: data });
    const auth = { cookie: `auth_token=${token}` };
    expect((await call(0, "/api/webhooks", "synthetic-create-key-0001")).status).toBe(401);
    expect((await call(0, "/api/webhooks", "synthetic-create-key-0001", { ...auth, origin: "https://evil.example" })).status).toBe(403);
    expect(db.query("SELECT count(*) n FROM webhooks").get()).toEqual({ n: 0 });
    const create = await Promise.all(ports.map((_, i) => call(i, "/api/webhooks", "synthetic-create-key-0001", auth)));
    expect(create.map(r => r.status).sort()).toEqual([200, 201]);
    for (const r of create) expect(r.headers.get("cache-control")).toBe("no-store");
    const values: any[] = await Promise.all(create.map(r => r.json()));
    expect(values[0].id).toBe(values[1].id);
    expect(values.filter(v => v.secret).length).toBe(1);
    const id = values[0].id;
    const first = values.find(v => v.secret).secret;
    const initialVersion = values.find(v => v.secret).version;
    expect(typeof initialVersion).toBe("string");
    const endpoint = `/api/webhooks/${id}/rotate-secret`;
    const candidates = await Promise.all(ports.map((_, i) => call(i, endpoint, `synthetic-distinct-rotate-000${i}`, { ...auth, "if-match": initialVersion }, "")));
    expect(candidates.map(r => r.status).sort()).toEqual([201, 409]);
    const candidateBodies: any[] = await Promise.all(candidates.map(r => r.json()));
    const winner = candidateBodies.find(v => v.secret);
    expect(decrypt((db.query("SELECT secret FROM webhooks WHERE id = ?").get(id) as any).secret, { quiet: true })).toBe(winner.secret);
    expect(db.query("SELECT count(*) n FROM audit_log").get()).toEqual({ n: 2 });
    const winnerIndex = candidateBodies.indexOf(winner);
    const retry = await call(1 - winnerIndex, endpoint, `synthetic-distinct-rotate-000${winnerIndex}`, { ...auth, "if-match": initialVersion }, "");
    expect(retry.status).toBe(200);
    expect((await retry.json() as any).secret).toBeUndefined();
    expect((await call(0, endpoint, `synthetic-distinct-rotate-000${winnerIndex}`, { ...auth, "if-match": winner.version }, "")).status).toBe(409);
    expect((await call(0, endpoint, "synthetic-missing-version-0001", auth, "")).status).toBe(409);
    const rotate = await Promise.all(ports.map((_, i) => call(i, endpoint, "synthetic-rotate-key-0001", { ...auth, "if-match": winner.version }, "")));
    expect(rotate.map(r => r.status).sort()).toEqual([200, 201]);
    const rotations: any[] = await Promise.all(rotate.map(r => r.json()));
    expect(rotations.filter(v => v.secret).length).toBe(1);
    const second = rotations.find(v => v.secret).secret;
    expect(second).not.toBe(first);
    expect(decrypt((db.query("SELECT secret FROM webhooks WHERE id = ?").get(id) as any).secret, { quiet: true })).toBe(second);
    expect(db.query("SELECT count(*) n FROM audit_log").get()).toEqual({ n: 3 });
    const exposed = JSON.stringify({ values, rotations, audit: db.query("SELECT * FROM audit_log").all(), requests: db.query("SELECT * FROM webhook_provision_requests").all() });
    for (const s of ["private-path", "private-token", "synthetic-create-key-0001", "synthetic-rotate-key-0001"]) expect(exposed).not.toContain(s);
    const conflict = await call(0, "/api/webhooks", "synthetic-create-key-0001", auth, JSON.stringify({ url: "https://dns.example/other", events: ["test.ping"] }));
    expect(conflict.status).toBe(409);
    expect(await conflict.text()).not.toContain("synthetic-create-key-0001");
  } finally { for (const p of workers) p.kill(); await Promise.all(workers.map(p => p.exited)); db.close(); delete process.env.STORAGE_ENCRYPTION_KEY; rmSync(dir, { recursive: true, force: true }); }
}, 30000);

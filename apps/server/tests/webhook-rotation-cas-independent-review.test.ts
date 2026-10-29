import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { SignJWT } from "jose";
import { decrypt } from "../src/lib/db/encryption";

test("rotation CAS across independent HTTP processes rolls back failures and never rediscloses secrets", async () => {
  const dir = mkdtempSync(join(process.env.TMPDIR!, "rotation-review-"));
  const path = join(dir, "db.sqlite");
  const key = "synthetic-cas-encryption-key";
  const previousKey = process.env.STORAGE_ENCRYPTION_KEY;
  process.env.STORAGE_ENCRYPTION_KEY = key;
  const db = new Database(path);
  db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE webhooks (id TEXT PRIMARY KEY, url TEXT, events TEXT, secret TEXT, description TEXT, kind TEXT); CREATE TABLE webhook_provision_requests (request_key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, webhook_id TEXT NOT NULL); CREATE TABLE audit_log (timestamp TEXT, action TEXT, actor TEXT, target TEXT, resource_type TEXT, status TEXT);`);
  const workers = [0, 1, 2].map(i => Bun.spawn([process.execPath, join(import.meta.dir, "helpers/webhook-http-worker.ts"), path, join(dir, `port${i}`)], { stdout: "ignore", stderr: "pipe", env: { ...process.env, DATA_DIR: join(dir, `worker${i}`), SQLITE_FILE: join(dir, `worker${i}`, "storage.sqlite"), JWT_SECRET: "synthetic-cas-jwt", STORAGE_ENCRYPTION_KEY: i === 2 ? "" : key } }));
  try {
    const deadline = Date.now() + 15000;
    while (![0, 1, 2].every(i => existsSync(join(dir, `port${i}`)))) {
      if (Date.now() > deadline || workers.some(p => p.exitCode !== null)) throw new Error("worker startup failed");
      await Bun.sleep(20);
    }
    const ports = [0, 1, 2].map(i => readFileSync(join(dir, `port${i}`), "utf8"));
    const token = await new SignJWT({ authenticated: true }).setProtectedHeader({ alg: "HS256" }).sign(new TextEncoder().encode("synthetic-cas-jwt"));
    const call = (i: number, endpoint: string, requestKey: string, version?: string, body = "") => fetch(`http://127.0.0.1:${ports[i]}${endpoint}`, { method: "POST", headers: { "content-type": "application/json", cookie: `auth_token=${token}`, "idempotency-key": requestKey, ...(version ? { "if-match": version } : {}) }, body });
    const createdResponse = await call(0, "/api/webhooks", "synthetic-cas-create-key-01", undefined, JSON.stringify({ url: "https://dns.example/secret-path?token=hidden", events: ["test.ping"] }));
    expect(createdResponse.status).toBe(201);
    const created: any = await createdResponse.json();
    const endpoint = `/api/webhooks/${created.id}/rotate-secret`;
    const snapshot = () => ({ webhook: db.query("SELECT secret FROM webhooks WHERE id=?").get(created.id), requests: db.query("SELECT * FROM webhook_provision_requests ORDER BY request_key").all(), audit: db.query("SELECT * FROM audit_log ORDER BY rowid").all() });
    const original = snapshot();
    const noKey = await call(2, endpoint, "synthetic-cas-no-key-00001", created.version);
    expect(noKey.status).toBe(409);
    expect(snapshot()).toEqual(original);
    db.exec("CREATE TRIGGER fail_rotation_audit BEFORE INSERT ON audit_log WHEN NEW.action='webhook.rotate' BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END");
    const failures = await Promise.all([0, 1].map(i => call(i, endpoint, `synthetic-cas-failure-key-0${i}`, created.version)));
    expect(failures.map(r => r.status)).toEqual([409, 409]);
    expect(snapshot()).toEqual(original);
    db.exec("DROP TRIGGER fail_rotation_audit");
    const racers = await Promise.all([0, 1].map(i => call(i, endpoint, `synthetic-cas-racer-key-00${i}`, created.version)));
    expect(racers.map(r => r.status).sort()).toEqual([201, 409]);
    const values: any[] = await Promise.all(racers.map(r => r.json()));
    const winnerIndex = values.findIndex(v => v.secret);
    const winner = values[winnerIndex];
    expect(winner.version).not.toBe(created.version);
    expect(decrypt((snapshot().webhook as any).secret, { quiet: true })).toBe(winner.secret);
    const afterRace = snapshot();
    expect(afterRace.requests).toHaveLength(2);
    expect(afterRace.audit).toHaveLength(2);
    const replay = await call(1 - winnerIndex, endpoint, `synthetic-cas-racer-key-00${winnerIndex}`, created.version);
    expect(replay.status).toBe(200);
    expect(replay.headers.get("cache-control")).toBe("no-store");
    expect(await replay.json()).toEqual({ id: created.id, status: "replayed" });
    const stale = await call(0, endpoint, "synthetic-cas-stale-key-001", created.version);
    expect(stale.status).toBe(409);
    const changedMatch = await call(0, endpoint, `synthetic-cas-racer-key-00${winnerIndex}`, winner.version);
    expect(changedMatch.status).toBe(409);
    expect(snapshot()).toEqual(afterRace);
    const visible = JSON.stringify([afterRace.requests, afterRace.audit, values]);
    for (const sensitive of [created.secret, "secret-path", "hidden", "synthetic-cas-racer-key-000", "synthetic-cas-racer-key-001"]) expect(visible).not.toContain(sensitive);
  } finally {
    for (const p of workers) p.kill();
    await Promise.all(workers.map(p => p.exited));
    db.close();
    if (previousKey === undefined) delete process.env.STORAGE_ENCRYPTION_KEY; else process.env.STORAGE_ENCRYPTION_KEY = previousKey;
    rmSync(dir, { recursive: true, force: true });
  }
}, 30000);

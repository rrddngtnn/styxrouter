import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { SignJWT } from "jose";
import { createBunSqliteAdapter } from "../src/lib/db/adapters/bunSqliteAdapter";
import { createWebhookProvisioningApi } from "../server/webhookProvisioning";

test("provisioning requires session and rejects cross-origin; response is no-store and replay omits secret", async () => {
  process.env.JWT_SECRET = "synthetic-jwt-secret";
  process.env.STORAGE_ENCRYPTION_KEY = "synthetic-provision-http-key";
  const db = createBunSqliteAdapter(new Database(":memory:"), ":memory:");
  db.exec(`CREATE TABLE webhooks (id TEXT PRIMARY KEY, url TEXT, events TEXT, secret TEXT, description TEXT, kind TEXT);
    CREATE TABLE webhook_provision_requests (request_key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, webhook_id TEXT NOT NULL);
    CREATE TABLE audit_log (timestamp TEXT, action TEXT, actor TEXT, target TEXT, resource_type TEXT, status TEXT);`);
  try {
    const api = createWebhookProvisioningApi(db, (url) => new URL(url));
    const token = await new SignJWT({ authenticated: true }).setProtectedHeader({ alg: "HS256" }).sign(new TextEncoder().encode(process.env.JWT_SECRET));
    const body = JSON.stringify({ url: "https://example.com/hook", events: ["test.ping"] });
    const headers = { "content-type": "application/json", "idempotency-key": "synthetic-request-key-0001", host: "localhost" };
    const request = (extra: Record<string, string> = {}) => api.request("http://localhost/api/webhooks", { method: "POST", headers: { ...headers, ...extra }, body });
    const denied = await request();
    expect(denied.status).toBe(401);
    expect(denied.headers.get("cache-control")).toBe("no-store");
    expect((await request({ cookie: `auth_token=${token}`, origin: "https://evil.example" })).status).toBe(403);
    const oversized = await api.request("http://localhost/api/webhooks", { method: "POST", headers: { ...headers, cookie: `auth_token=${token}` }, body: "x".repeat(20000) });
    expect(oversized.status).toBe(413);
    const created = await request({ cookie: `auth_token=${token}` });
    expect(created.status).toBe(201);
    expect(created.headers.get("cache-control")).toBe("no-store");
    const payload = await created.json() as { id: string; secret: string; version: string };
    expect(payload.secret).toMatch(/^whsec_[a-f0-9]{48}$/);
    const replay = await request({ cookie: `auth_token=${token}` });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ id: payload.id, status: "replayed" });
    const rotate = () => api.request(`http://localhost/api/webhooks/${payload.id}/rotate-secret`, { method: "POST", headers: { ...headers, cookie: `auth_token=${token}`, "idempotency-key": "synthetic-rotation-key-001", "if-match": payload.version } });
    const rotated = await rotate();
    expect(rotated.status).toBe(201);
    expect((await rotated.json() as { secret: string }).secret).not.toBe(payload.secret);
    const rotationReplay = await rotate();
    expect(rotationReplay.status).toBe(200);
    expect(await rotationReplay.json()).toEqual({ id: payload.id, status: "replayed" });
  } finally { db.close(); delete process.env.JWT_SECRET; delete process.env.STORAGE_ENCRYPTION_KEY; }
});

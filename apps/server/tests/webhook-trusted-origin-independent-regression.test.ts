import { expect, test, spyOn } from "bun:test";
import { Database } from "bun:sqlite";
import dns from "node:dns";
import { SignJWT } from "jose";
import { createBunSqliteAdapter } from "../src/lib/db/adapters/bunSqliteAdapter";
import { createWebhookProvisioningApi } from "../server/webhookProvisioning";

test("configured public origin works behind host-rewriting proxy and rejects scheme downgrade", async () => {
  const saved = { ...process.env };
  process.env.JWT_SECRET = "synthetic-webhook-origin-jwt";
  process.env.STORAGE_ENCRYPTION_KEY = "synthetic-webhook-origin-key";
  process.env.STYX_TRUSTED_PUBLIC_ORIGIN = "https://router.example";
  const db = createBunSqliteAdapter(new Database(":memory:"), ":memory:");
  db.exec(`CREATE TABLE webhooks (id TEXT PRIMARY KEY, url TEXT, events TEXT, secret TEXT, description TEXT, kind TEXT); CREATE TABLE webhook_provision_requests (request_key TEXT PRIMARY KEY, fingerprint TEXT, webhook_id TEXT); CREATE TABLE audit_log (timestamp TEXT, action TEXT, actor TEXT, target TEXT, resource_type TEXT, status TEXT);`);
  const lookup = spyOn(dns.promises, "lookup").mockImplementation(async () => [{ address: "8.8.8.8", family: 4 }] as any);
  try {
    const api = createWebhookProvisioningApi(db, url => new URL(url));
    const token = await new SignJWT({ authenticated: true }).setProtectedHeader({ alg: "HS256" }).sign(new TextEncoder().encode(process.env.JWT_SECRET));
    const call = (origin: string, key: string) => api.request("http://backend.internal/api/webhooks", { method: "POST", headers: { host: "backend.internal", origin, cookie: `auth_token=${token}`, "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify({ url: "https://dns.example/private?token=synthetic", events: ["test.ping"] }) });
    const rejected = await call("http://router.example", "synthetic-origin-request-001");
    expect(rejected.status).toBe(403);
    const accepted = await call("https://router.example", "synthetic-origin-request-002");
    expect(accepted.status).toBe(201);
    expect(accepted.headers.get("cache-control")).toBe("no-store");
    expect(db.prepare("SELECT count(*) AS n FROM webhooks").get()).toEqual({ n: 1 });
  } finally {
    lookup.mockRestore(); db.close();
    for (const key of ["JWT_SECRET", "STORAGE_ENCRYPTION_KEY", "STYX_TRUSTED_PUBLIC_ORIGIN"]) {
      if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
    }
  }
});
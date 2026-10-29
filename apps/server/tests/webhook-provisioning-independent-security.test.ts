import { expect, test, spyOn } from "bun:test";
import { Database } from "bun:sqlite";
import dns from "node:dns";
import { SignJWT } from "jose";
import { createBunSqliteAdapter } from "../src/lib/db/adapters/bunSqliteAdapter";
import { createWebhookProvisioningApi } from "../server/webhookProvisioning";

test("untrusted forwarded host cannot authorize a cross-origin provisioning request", async () => {
  process.env.JWT_SECRET = "independent-test-jwt";
  process.env.STORAGE_ENCRYPTION_KEY = "independent-test-storage";
  const db = createBunSqliteAdapter(new Database(":memory:"), ":memory:");
  db.exec(`CREATE TABLE webhooks (id TEXT PRIMARY KEY, url TEXT, events TEXT, secret TEXT, description TEXT, kind TEXT); CREATE TABLE webhook_provision_requests (request_key TEXT PRIMARY KEY, fingerprint TEXT, webhook_id TEXT); CREATE TABLE audit_log (timestamp TEXT, action TEXT, actor TEXT, target TEXT, resource_type TEXT, status TEXT);`);
  const lookup = spyOn(dns.promises, "lookup").mockImplementation(async () => [{ address: "8.8.8.8", family: 4 }] as any);
  try {
    const api = createWebhookProvisioningApi(db, url => new URL(url));
    const token = await new SignJWT({ authenticated: true }).setProtectedHeader({ alg: "HS256" }).sign(new TextEncoder().encode(process.env.JWT_SECRET));
    const response = await api.request("http://localhost/api/webhooks", { method: "POST", headers: { host: "localhost", origin: "https://evil.example", "x-forwarded-host": "evil.example", cookie: `auth_token=${token}`, "content-type": "application/json", "idempotency-key": "independent-request-key-001" }, body: JSON.stringify({ url: "https://dns.example/hook", events: ["test.ping"] }) });
    expect(response.status).toBe(403);
    expect(db.prepare("SELECT count(*) n FROM webhooks").get()).toEqual({ n: 0 });
    const plainHttp = await api.request("http://localhost/api/webhooks", { method: "POST", headers: { host: "localhost", cookie: `auth_token=${token}`, "content-type": "application/json", "idempotency-key": "independent-request-key-002" }, body: JSON.stringify({ url: "http://dns.example/hook", events: ["test.ping"] }) });
    expect(plainHttp.status).toBe(400);
    expect(db.prepare("SELECT count(*) n FROM webhooks").get()).toEqual({ n: 0 });
  } finally { lookup.mockRestore(); db.close(); delete process.env.JWT_SECRET; delete process.env.STORAGE_ENCRYPTION_KEY; }
});

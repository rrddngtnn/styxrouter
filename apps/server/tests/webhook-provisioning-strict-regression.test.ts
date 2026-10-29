import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { SignJWT } from "jose";
import { createBunSqliteAdapter } from "../src/lib/db/adapters/bunSqliteAdapter";
import { createWebhookProvisioningApi } from "../server/webhookProvisioning";

test("provisioning enforces public-only validation independently of an injected permissive guard", async () => {
  process.env.JWT_SECRET = "synthetic-jwt-secret";
  process.env.STORAGE_ENCRYPTION_KEY = "synthetic-provision-key";
  const db = createBunSqliteAdapter(new Database(":memory:"), ":memory:");
  db.exec(`CREATE TABLE webhooks (id TEXT PRIMARY KEY, url TEXT, events TEXT, secret TEXT, description TEXT, kind TEXT); CREATE TABLE webhook_provision_requests (request_key TEXT PRIMARY KEY, fingerprint TEXT, webhook_id TEXT); CREATE TABLE audit_log (timestamp TEXT, action TEXT, actor TEXT, target TEXT, resource_type TEXT, status TEXT);`);
  try {
    const api = createWebhookProvisioningApi(db, (url) => new URL(url));
    const token = await new SignJWT({ authenticated: true }).setProtectedHeader({ alg: "HS256" }).sign(new TextEncoder().encode(process.env.JWT_SECRET));
    for (const url of ["http://127.0.0.1/secret", "http://[::1]/secret", "https://user:password@example.com/"]) {
      const response = await api.request("http://localhost/api/webhooks", { method: "POST", headers: { cookie: `auth_token=${token}`, host: "localhost", "content-type": "application/json", "idempotency-key": "synthetic-request-key-0001" }, body: JSON.stringify({ url, events: ["test.ping"] }) });
      expect(response.status).toBe(400);
      expect(await response.text()).not.toContain(url);
    }
    expect(db.prepare("SELECT * FROM webhooks").all()).toHaveLength(0);
  } finally { db.close(); delete process.env.JWT_SECRET; delete process.env.STORAGE_ENCRYPTION_KEY; }
});

import { expect, test, spyOn } from "bun:test";
import { Database } from "bun:sqlite";
import dns from "node:dns";
import { SignJWT } from "jose";
import { createBunSqliteAdapter } from "../src/lib/db/adapters/bunSqliteAdapter";
import { createWebhookProvisioningApi } from "../server/webhookProvisioning";

test("create fails closed before persistence for private or failed DNS and redacts error", async () => {
  process.env.JWT_SECRET = "synthetic-jwt-secret";
  process.env.STORAGE_ENCRYPTION_KEY = "synthetic-encryption-key";
  const db = createBunSqliteAdapter(new Database(":memory:"), ":memory:");
  db.exec(`CREATE TABLE webhooks (id TEXT PRIMARY KEY, url TEXT, events TEXT, secret TEXT, description TEXT, kind TEXT); CREATE TABLE webhook_provision_requests (request_key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, webhook_id TEXT NOT NULL); CREATE TABLE audit_log (timestamp TEXT, action TEXT, actor TEXT, target TEXT, resource_type TEXT, status TEXT);`);
  const lookup = spyOn(dns.promises, "lookup").mockImplementation(async () => [{ address: "127.0.0.1", family: 4 }] as any);
  try {
    const api = createWebhookProvisioningApi(db, url => new URL(url));
    const token = await new SignJWT({ authenticated: true }).setProtectedHeader({ alg: "HS256" }).sign(new TextEncoder().encode(process.env.JWT_SECRET));
    const request = () => api.request("http://localhost/api/webhooks", { method: "POST", headers: { cookie: `auth_token=${token}`, host: "localhost", "content-type": "application/json", "idempotency-key": "sensitive-request-key-0001" }, body: JSON.stringify({ url: "https://dns.example/private-path?token=private-token", events: ["test.ping"] }) });
    for (const mode of ["private", "mixed", "empty", "failure"]) {
      if (mode === "mixed") lookup.mockImplementation(async () => [{ address: "8.8.8.8", family: 4 }, { address: "10.0.0.1", family: 4 }] as any);
      if (mode === "empty") lookup.mockImplementation(async () => [] as any);
      if (mode === "failure") lookup.mockImplementation(async () => { throw new Error("private-token sensitive-request-key-0001"); });
      const response = await request();
      expect(response.status).toBe(400);
      const text = await response.text();
      for (const sensitive of ["private-token", "private-path", "sensitive-request-key-0001"]) expect(text).not.toContain(sensitive);
      expect(db.prepare("SELECT count(*) n FROM webhooks").get()).toEqual({ n: 0 });
      expect(db.prepare("SELECT count(*) n FROM webhook_provision_requests").get()).toEqual({ n: 0 });
      expect(db.prepare("SELECT count(*) n FROM audit_log").get()).toEqual({ n: 0 });
    }
  } finally { lookup.mockRestore(); db.close(); delete process.env.JWT_SECRET; delete process.env.STORAGE_ENCRYPTION_KEY; }
});

import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createBunSqliteAdapter } from "../src/lib/db/adapters/bunSqliteAdapter";
import { provisionManagedWebhook } from "../src/lib/db/webhookProvisioning";
import { decryptWebhookSecret } from "../src/lib/db/webhookSecureStorage";

test("provision once with encrypted secret, atomic audit and safe retries", () => {
  process.env.STORAGE_ENCRYPTION_KEY = "synthetic-provision-test-key";
  const db = createBunSqliteAdapter(new Database(":memory:"), ":memory:");
  db.exec(`CREATE TABLE webhooks (id TEXT PRIMARY KEY, url TEXT, events TEXT, secret TEXT, description TEXT, kind TEXT);
    CREATE TABLE webhook_provision_requests (request_key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, webhook_id TEXT NOT NULL);
    CREATE TABLE audit_log (timestamp TEXT, action TEXT, actor TEXT, target TEXT, resource_type TEXT, status TEXT);`);
  const input = { url: "https://example.com/secret-path", events: ["test.ping"] as const, description: "" };
  try {
    const first = provisionManagedWebhook(db, "synthetic-request-key-0001", { ...input, events: [...input.events] });
    expect(first.status).toBe("created");
    if (first.status !== "created") throw new Error("expected creation");
    const row = db.prepare("SELECT secret FROM webhooks WHERE id = ?").get(first.id) as {secret: string};
    expect(decryptWebhookSecret(row.secret)).toBe(first.secret);
    expect(row.secret).not.toContain(first.secret);
    const again = provisionManagedWebhook(db, "synthetic-request-key-0001", { ...input, events: [...input.events] });
    expect(again).toEqual({ status: "replayed", id: first.id });
    expect(() => provisionManagedWebhook(db, "synthetic-request-key-0001", { ...input, description: "different", events: [...input.events] })).toThrow();
    expect(db.prepare("SELECT * FROM audit_log").all()).toHaveLength(1);
    db.exec("CREATE TRIGGER audit_reject BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'secret error'); END");
    expect(() => provisionManagedWebhook(db, "synthetic-request-key-0002", { ...input, events: [...input.events] })).toThrow();
    expect(db.prepare("SELECT * FROM webhooks").all()).toHaveLength(1);
    expect(db.prepare("SELECT * FROM webhook_provision_requests").all()).toHaveLength(1);
  } finally { db.close(); delete process.env.STORAGE_ENCRYPTION_KEY; }
});

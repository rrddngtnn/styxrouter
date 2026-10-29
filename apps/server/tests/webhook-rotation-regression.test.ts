import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createBunSqliteAdapter } from "../src/lib/db/adapters/bunSqliteAdapter";
import { provisionManagedWebhook, rotateManagedWebhookSecret } from "../src/lib/db/webhookProvisioning";
import { decryptWebhookSecret } from "../src/lib/db/webhookSecureStorage";

test("explicit rotation is encrypted, atomic, and replay never reveals a secret", () => {
  process.env.STORAGE_ENCRYPTION_KEY = "synthetic-rotation-key";
  const db = createBunSqliteAdapter(new Database(":memory:"), ":memory:");
  db.exec(`CREATE TABLE webhooks (id TEXT PRIMARY KEY, url TEXT, events TEXT, secret TEXT, description TEXT, kind TEXT);
  CREATE TABLE webhook_provision_requests (request_key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, webhook_id TEXT NOT NULL);
  CREATE TABLE audit_log (timestamp TEXT, action TEXT, actor TEXT, target TEXT, resource_type TEXT, status TEXT);`);
  try {
    const created = provisionManagedWebhook(db, "synthetic-create-key-00001", {url:"https://example.com", events:["test.ping"], description:""});
    if (created.status !== "created") throw new Error("expected created");
    const rotated = rotateManagedWebhookSecret(db, "synthetic-rotate-key-00001", created.id, created.version);
    if (rotated.status !== "rotated") throw new Error("expected rotation");
    expect(rotated.secret).not.toBe(created.secret);
    const row = db.prepare("SELECT secret FROM webhooks WHERE id = ?").get(created.id) as {secret:string};
    expect(decryptWebhookSecret(row.secret)).toBe(rotated.secret);
    expect(rotateManagedWebhookSecret(db, "synthetic-rotate-key-00001", created.id, created.version)).toEqual({status:"replayed", id:created.id});
    expect(() => rotateManagedWebhookSecret(db, "synthetic-rotate-key-00001", "different", created.version)).toThrow();
    db.exec("CREATE TRIGGER reject_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'fail'); END");
    expect(() => rotateManagedWebhookSecret(db, "synthetic-rotate-key-00002", created.id, rotated.version)).toThrow();
    expect((db.prepare("SELECT secret FROM webhooks WHERE id = ?").get(created.id) as {secret:string}).secret).toBe(row.secret);
    expect(db.prepare("SELECT * FROM audit_log").all()).toHaveLength(2);
  } finally { db.close(); delete process.env.STORAGE_ENCRYPTION_KEY; }
});

import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createBunSqliteAdapter } from "../src/lib/db/adapters/bunSqliteAdapter";
import { createManagedWebhook, decryptWebhookSecret } from "../src/lib/db/webhookSecureStorage";

test("managed secrets are encrypted in SQLite and decrypted only for delivery", () => {
  const previous = process.env.STORAGE_ENCRYPTION_KEY;
  const db = createBunSqliteAdapter(new Database(":memory:"), ":memory:");
  db.exec("CREATE TABLE webhooks (id TEXT PRIMARY KEY, url TEXT, events TEXT, secret TEXT, description TEXT, kind TEXT)");
  try {
    delete process.env.STORAGE_ENCRYPTION_KEY;
    expect(() => createManagedWebhook(db, { url: "https://example.com/hook", events: ["test.ping"], description: "" })).toThrow();
    expect(db.prepare("SELECT * FROM webhooks").all()).toHaveLength(0);
    process.env.STORAGE_ENCRYPTION_KEY = "synthetic-test-encryption-key";
    const result = createManagedWebhook(db, { url: "https://example.com/hook", events: ["test.ping"], description: "" });
    const row = db.prepare("SELECT secret FROM webhooks WHERE id = ?").get(result.id) as { secret: string };
    expect(JSON.stringify(result)).not.toContain(row.secret);
    expect(row.secret.startsWith("enc:v1:")).toBe(true);
    const secret = decryptWebhookSecret(row.secret);
    expect(secret).toMatch(/^whsec_[a-f0-9]{48}$/);
    expect(row.secret).not.toContain(secret!);
    expect(() => decryptWebhookSecret(row.secret.slice(0, -2) + "zz")).toThrow();
    expect(decryptWebhookSecret("synthetic-legacy-secret")).toBe("synthetic-legacy-secret");
    db.exec("CREATE TRIGGER reject_webhook BEFORE INSERT ON webhooks BEGIN SELECT RAISE(ABORT, 'reject'); END");
    expect(() => createManagedWebhook(db, { url: "https://example.com", events: ["test.ping"], description: "" })).toThrow();
    expect(db.prepare("SELECT * FROM webhooks").all()).toHaveLength(1);
    process.env.STORAGE_ENCRYPTION_KEY = "different-synthetic-key";
    expect(() => decryptWebhookSecret(row.secret)).toThrow();
    delete process.env.STORAGE_ENCRYPTION_KEY;
    expect(() => decryptWebhookSecret(row.secret)).toThrow();
  } finally {
    if (previous === undefined) delete process.env.STORAGE_ENCRYPTION_KEY; else process.env.STORAGE_ENCRYPTION_KEY = previous;
    db.close();
  }
});

import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createBunSqliteAdapter } from "../src/lib/db/adapters/bunSqliteAdapter";
import { provisionManagedWebhook, rotateManagedWebhookSecret } from "../src/lib/db/webhookProvisioning";
import { decryptWebhookSecret } from "../src/lib/db/webhookSecureStorage";
import { createHash } from "node:crypto";

test("restored ciphertext that cannot be authenticated cannot be replaced by rotation", () => {
  process.env.STORAGE_ENCRYPTION_KEY = "synthetic-backup-key";
  const dir = mkdtempSync(join(process.env.TMPDIR!, "webhook-backup-safety-"));
  const source = new Database(join(dir, "source.sqlite"));
  const adapter = createBunSqliteAdapter(source, join(dir, "source.sqlite"));
  let restored: Database | undefined;
  try {
    adapter.exec(`CREATE TABLE webhooks (id TEXT PRIMARY KEY, url TEXT, events TEXT, secret TEXT, description TEXT, kind TEXT);
      CREATE TABLE webhook_provision_requests (request_key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, webhook_id TEXT NOT NULL);
      CREATE TABLE audit_log (timestamp TEXT, action TEXT, actor TEXT, target TEXT, resource_type TEXT, status TEXT);`);
    const created = provisionManagedWebhook(adapter, "synthetic-backup-create-001", {url:"https://example.com", events:["test.ping"], description:""});
    if (created.status !== "created") throw new Error("expected created");
    adapter.exec(`VACUUM INTO '${join(dir, "backup.sqlite").replaceAll("'", "''")}'`);
    restored = new Database(join(dir, "backup.sqlite"));
    const restoredAdapter = createBunSqliteAdapter(restored, join(dir, "backup.sqlite"));
    const row = restoredAdapter.prepare("SELECT secret FROM webhooks WHERE id=?").get(created.id) as {secret:string};
    expect(decryptWebhookSecret(row.secret)).toBe(created.secret);
    // Emulate authenticated ciphertext from a different storage key, without changing the process key cache.
    const corrupt = row.secret.slice(0, -1) + (row.secret.endsWith("0") ? "1" : "0");
    restoredAdapter.prepare("UPDATE webhooks SET secret=? WHERE id=?").run(corrupt, created.id);
    const version = `"${createHash("sha256").update(corrupt).digest("hex")}"`;
    expect(() => rotateManagedWebhookSecret(restoredAdapter, "synthetic-backup-rotate-001", created.id, version)).toThrow();
    expect(restoredAdapter.prepare("SELECT secret FROM webhooks WHERE id=?").get(created.id)).toEqual({secret:corrupt});
    expect(restoredAdapter.prepare("SELECT * FROM webhook_provision_requests").all()).toHaveLength(1);
    expect(restoredAdapter.prepare("SELECT * FROM audit_log").all()).toHaveLength(1);
  } finally { restored?.close(); adapter.close(); delete process.env.STORAGE_ENCRYPTION_KEY; rmSync(dir,{recursive:true,force:true}); }
});

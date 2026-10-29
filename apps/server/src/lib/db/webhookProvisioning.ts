import crypto from "node:crypto";
import type { SqliteAdapter } from "./adapters/types";
import { decrypt, encrypt, hasCurrentEncryptionKey } from "./encryption";
import type { SubscriptionInput } from "../../../server/webhookManagementValidation";

// Opaque representation of the exact stored ciphertext; never exposes the secret.
function versionOf(ciphertext: string): string {
  return `"${crypto.createHash("sha256").update(ciphertext).digest("hex")}"`;
}

/** Unmounted primitive. Caller must authenticate and validate the destination first. */
export function provisionManagedWebhook(db: SqliteAdapter, requestKey: string, input: SubscriptionInput):
  { status: "created"; id: string; secret: string; version: string } | { status: "replayed"; id: string } {
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(requestKey) || !hasCurrentEncryptionKey()) throw new Error("Webhook provisioning unavailable");
  const key = process.env.STORAGE_ENCRYPTION_KEY!;
  const requestHash = crypto.createHash("sha256").update(requestKey).digest("hex");
  const fingerprint = crypto.createHmac("sha256", key).update(JSON.stringify([input.url, input.events, input.description])).digest("hex");
  try {
    return db.immediate(() => {
      // Validate existing encrypted secrets under the write lock so concurrent
      // processes using different keys cannot create an unreadable mixed store.
      const stored = db.prepare("SELECT secret FROM webhooks WHERE secret LIKE 'enc:%'").all() as { secret: string }[];
      for (const row of stored) {
        if (!/^enc:v1:[a-f0-9]{32}:[a-f0-9]+:[a-f0-9]{32}$/.test(row.secret) || !decrypt(row.secret, { quiet: true }) || !hasCurrentEncryptionKey()) throw new Error("encryption");
      }
      const previous = db.prepare("SELECT fingerprint, webhook_id FROM webhook_provision_requests WHERE request_key = ?").get(requestHash) as { fingerprint: string; webhook_id: string } | undefined;
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new Error("conflict");
        return { status: "replayed" as const, id: previous.webhook_id };
      }
      const secret = `whsec_${crypto.randomBytes(24).toString("hex")}`;
      const ciphertext = encrypt(secret);
      if (typeof ciphertext !== "string" || !/^enc:v1:[a-f0-9]{32}:[a-f0-9]+:[a-f0-9]{32}$/.test(ciphertext) || decrypt(ciphertext, { quiet: true }) !== secret || !hasCurrentEncryptionKey()) throw new Error("encryption");
      const id = crypto.randomUUID();
      db.prepare("INSERT INTO webhooks (id, url, events, secret, description, kind) VALUES (?, ?, ?, ?, ?, ?)").run(id, input.url, JSON.stringify(input.events), ciphertext, input.description, "custom");
      db.prepare("INSERT INTO webhook_provision_requests (request_key, fingerprint, webhook_id) VALUES (?, ?, ?)").run(requestHash, fingerprint, id);
      db.prepare("INSERT INTO audit_log (timestamp, action, actor, target, resource_type, status) VALUES (?, ?, ?, ?, ?, ?)").run(new Date().toISOString(), "webhook.create", "admin", id, "admin_api", "success");
      return { status: "created" as const, id, secret, version: versionOf(ciphertext) };
    });
  } catch {
    throw new Error("Webhook provisioning unavailable or request conflict");
  }
}

/** Explicit recovery: never redisclose the secret on an idempotent replay. */
export function rotateManagedWebhookSecret(db: SqliteAdapter, requestKey: string, id: string, expectedVersion: string):
  { status: "rotated"; id: string; secret: string; version: string } | { status: "replayed"; id: string } {
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(requestKey) || !/^"[a-f0-9]{64}"$/.test(expectedVersion) || !hasCurrentEncryptionKey()) throw new Error("Webhook rotation unavailable");
  const requestHash = crypto.createHash("sha256").update(requestKey).digest("hex");
  const fingerprint = crypto.createHmac("sha256", process.env.STORAGE_ENCRYPTION_KEY!).update(JSON.stringify(["rotate", id, expectedVersion])).digest("hex");
  try {
    return db.immediate(() => {
      const previous = db.prepare("SELECT fingerprint, webhook_id FROM webhook_provision_requests WHERE request_key = ?").get(requestHash) as { fingerprint: string; webhook_id: string } | undefined;
      if (previous) {
        if (previous.fingerprint !== fingerprint || previous.webhook_id !== id) throw new Error("conflict");
        return { status: "replayed" as const, id };
      }
      const current = db.prepare("SELECT secret FROM webhooks WHERE id = ? AND kind = ?").get(id, "custom") as { secret: string } | undefined;
      if (!current || typeof current.secret !== "string" || versionOf(current.secret) !== expectedVersion) throw new Error("conflict");
      // Never replace an unreadable encrypted secret: this may be a wrong-key restore.
      if (!/^enc:v1:[a-f0-9]{32}:[a-f0-9]+:[a-f0-9]{32}$/.test(current.secret) || !decrypt(current.secret, { quiet: true }) || !hasCurrentEncryptionKey()) throw new Error("encryption");
      const secret = `whsec_${crypto.randomBytes(24).toString("hex")}`;
      const ciphertext = encrypt(secret);
      if (typeof ciphertext !== "string" || !/^enc:v1:[a-f0-9]{32}:[a-f0-9]+:[a-f0-9]{32}$/.test(ciphertext) || decrypt(ciphertext, { quiet: true }) !== secret || !hasCurrentEncryptionKey()) throw new Error("encryption");
      const updated = db.prepare("UPDATE webhooks SET secret = ? WHERE id = ? AND kind = ? AND secret = ?").run(ciphertext, id, "custom", current.secret);
      if (updated.changes !== 1) throw new Error("conflict");
      db.prepare("INSERT INTO webhook_provision_requests (request_key, fingerprint, webhook_id) VALUES (?, ?, ?)").run(requestHash, fingerprint, id);
      db.prepare("INSERT INTO audit_log (timestamp, action, actor, target, resource_type, status) VALUES (?, ?, ?, ?, ?, ?)").run(new Date().toISOString(), "webhook.rotate", "admin", id, "admin_api", "success");
      return { status: "rotated" as const, id, secret, version: versionOf(ciphertext) };
    });
  } catch { throw new Error("Webhook rotation unavailable or request conflict"); }
}

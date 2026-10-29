import crypto from "node:crypto";
import type { SqliteAdapter } from "./adapters/types";
import { decrypt, encrypt, hasCurrentEncryptionKey } from "./encryption";
import type { SubscriptionInput } from "../../../server/webhookManagementValidation";

/** Unmounted storage primitive. URL validation and session authorization are caller obligations. */
export function createManagedWebhook(db: SqliteAdapter, input: SubscriptionInput): { id: string } {
  if (!hasCurrentEncryptionKey()) throw new Error("Webhook storage unavailable");
  const secret = `whsec_${crypto.randomBytes(24).toString("hex")}`;
  const ciphertext = encrypt(secret);
  if (typeof ciphertext !== "string" || !/^enc:v1:[a-f0-9]{32}:[a-f0-9]+:[a-f0-9]{32}$/.test(ciphertext) || ciphertext === secret || decrypt(ciphertext, { quiet: true }) !== secret || !hasCurrentEncryptionKey()) {
    throw new Error("Webhook storage unavailable");
  }
  const id = crypto.randomUUID();
  db.immediate(() => {
    db.prepare("INSERT INTO webhooks (id, url, events, secret, description, kind) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, input.url, JSON.stringify(input.events), ciphertext, input.description, "custom");
  });
  return { id };
}

/** Existing plaintext rows are preserved for legacy delivery; encrypted rows fail closed. */
export function decryptWebhookSecret(stored: string | null): string | null {
  if (stored === null) return null;
  if (!stored.startsWith("enc:")) return stored;
  if (!hasCurrentEncryptionKey() || !/^enc:v1:[a-f0-9]{32}:[a-f0-9]+:[a-f0-9]{32}$/.test(stored)) throw new Error("Webhook secret unavailable");
  const secret = decrypt(stored, { quiet: true });
  if (typeof secret !== "string" || !secret || !hasCurrentEncryptionKey()) throw new Error("Webhook secret unavailable");
  return secret;
}

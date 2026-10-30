import { test, expect } from "bun:test";
import { createCipheriv, randomBytes, scryptSync, createHash } from "node:crypto";
import { decrypt } from "../src/lib/db/encryption";

// Reproduces the regression where decrypt() stopped falling back to the LEGACY
// dynamic-salt key, even though its own docstring promises:
//   "Attempts static-salt key first (primary), then falls back to legacy
//    dynamic-salt key for backward compatibility."
//
// Tokens that were stored by an older StyxRouter build (dynamic-salt
// derivation) must still decrypt on the hot read path. Without the fallback
// they silently decrypt to null — a live credential becomes undecryptable
// until the one-shot startup migration happens to run, and any read before
// that (health sweep, request routing, webhook delivery) sees an empty secret.

const SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const PREFIX = "enc:v1:";

/** Encrypt exactly the way the old dynamic-salt build did. */
function encryptWithLegacyDynamicSalt(plaintext: string): string {
  const dynamicSalt = createHash("sha256").update(SECRET).digest().slice(0, 16);
  const legacyKey = scryptSync(SECRET, dynamicSalt, 32);
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", legacyKey, iv);
  let enc = cipher.update(plaintext, "utf8", "hex");
  enc += cipher.final("hex");
  const tag = cipher.getAuthTag().toString("hex");
  return `${PREFIX}${iv.toString("hex")}:${enc}:${tag}`;
}

test("decrypt() falls back to the legacy dynamic-salt key for old ciphertexts", () => {
  const prev = process.env.STORAGE_ENCRYPTION_KEY;
  process.env.STORAGE_ENCRYPTION_KEY = SECRET;
  try {
    const legacyCipher = encryptWithLegacyDynamicSalt("legacy-access-token");
    expect(legacyCipher.startsWith(PREFIX)).toBe(true);

    // Hot read path must recover the plaintext, not collapse it to null.
    expect(decrypt(legacyCipher, { quiet: true })).toBe("legacy-access-token");
  } finally {
    if (prev === undefined) delete process.env.STORAGE_ENCRYPTION_KEY;
    else process.env.STORAGE_ENCRYPTION_KEY = prev;
  }
});

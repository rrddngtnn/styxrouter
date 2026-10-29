import { test, expect, spyOn } from "bun:test";
import dns from "node:dns";
import crypto from "node:crypto";
import { encrypt } from "../src/lib/db/encryption";
import { deliverStoredWebhook } from "../src/lib/webhookDispatcher";
import * as transport from "../src/shared/network/remoteImageFetch";

test("stored encrypted and legacy secrets sign delivery, and undecryptable ciphertext never sends", async () => {
  const old = process.env.STORAGE_ENCRYPTION_KEY;
  process.env.STORAGE_ENCRYPTION_KEY = "synthetic-test-encryption-key";
  const encrypted = encrypt("synthetic-signing-secret")!;
  const lookup = spyOn(dns.promises, "lookup").mockImplementation(async () => [{ address: "8.8.8.8", family: 4 }] as any);
  const captured: RequestInit[] = [];
  const pinned = spyOn(transport, "createPinnedFetch").mockImplementation((() => async (_url: string, init: RequestInit) => { captured.push(init); return new Response(null, { status: 200 }); }) as any);
  const payload = { event: "test.ping" as const, timestamp: "now", data: { value: 1 } };
  try {
    expect((await deliverStoredWebhook("https://example.com/hook", payload, encrypted, 0)).success).toBe(true);
    expect((await deliverStoredWebhook("https://example.com/hook", payload, "legacy-secret", 0)).success).toBe(true);
    for (const [index, secret] of ["synthetic-signing-secret", "legacy-secret"].entries()) {
      const init = captured[index];
      expect((init.headers as Record<string, string>)["X-Webhook-Signature"]).toBe(`sha256=${crypto.createHmac("sha256", secret).update(init.body as string).digest("hex")}`);
    }
    process.env.STORAGE_ENCRYPTION_KEY = "wrong-synthetic-key";
    expect((await deliverStoredWebhook("https://example.com/hook", payload, encrypted, 0)).success).toBe(false);
    expect(captured).toHaveLength(2);
  } finally {
    pinned.mockRestore(); lookup.mockRestore();
    if (old === undefined) delete process.env.STORAGE_ENCRYPTION_KEY; else process.env.STORAGE_ENCRYPTION_KEY = old;
  }
});

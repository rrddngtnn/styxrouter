// Experimental unmounted application: the injected URL guard is not itself a security boundary.
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { SqliteAdapter } from "../src/lib/db/adapters/types";
import { provisionManagedWebhook, rotateManagedWebhookSecret } from "../src/lib/db/webhookProvisioning";
import { validateSubscriptionInput } from "./webhookManagementValidation";
import { requireAuth } from "./auth";
import { parseAndValidatePublicUrl } from "../src/shared/network/outboundUrlGuard";
import { resolveAllowedAddresses } from "../src/shared/network/remoteImageFetch";
import dns from "node:dns";

export function createWebhookProvisioningApi(db: SqliteAdapter, validatePublicUrl: (url: string) => URL) {
  const api = new Hono();
  api.use("*", async (c, next) => { c.header("Cache-Control", "no-store"); await next(); });
  api.use("*", requireAuth);
  // In compatibility mode, forwarding headers never override the actual Host.
  // Configured public-origin policy is enforced by requireAuth above.
  api.use("*", async (c, next) => {
    const origin = c.req.header("origin");
    // requireAuth enforces the configured canonical origin (and its tightly
    // scoped direct-loopback exception). Do not re-check against a rewritten Host.
    if (origin && process.env.STYX_TRUSTED_PUBLIC_ORIGIN === undefined) {
      try {
        const parsed = new URL(origin);
        if (!["http:", "https:"].includes(parsed.protocol) || parsed.host !== c.req.header("host")) {
          return c.json({ error: "Cross-origin request refused" }, 403);
        }
      } catch { return c.json({ error: "Cross-origin request refused" }, 403); }
    }
    await next();
  });
  api.use("*", bodyLimit({ maxSize: 8192, onError: (c) => c.json({ error: "Request too large" }, 413) }));
  api.post("/api/webhooks", async (c) => {
    let input;
    try {
      input = validateSubscriptionInput(await c.req.json(), (url) => { parseAndValidatePublicUrl(url); return validatePublicUrl(url); });
      const target = parseAndValidatePublicUrl(input.url);
      if (target.protocol !== "https:") throw new Error("HTTPS required");
      await resolveAllowedAddresses(target, "public-only", (host) => dns.promises.lookup(host, { all: true }), AbortSignal.timeout(5000));
    } catch { return c.json({ error: "Invalid subscription" }, 400); }
    try {
      const result = provisionManagedWebhook(db, c.req.header("idempotency-key") ?? "", input);
      if (result.status === "created") return c.json({ id: result.id, secret: result.secret, version: result.version }, 201);
      return c.json({ id: result.id, status: "replayed" }, 200);
    } catch { return c.json({ error: "Webhook provisioning unavailable or request conflict" }, 409); }
  });
  api.post("/api/webhooks/:id/rotate-secret", (c) => {
    try {
      const result = rotateManagedWebhookSecret(db, c.req.header("idempotency-key") ?? "", c.req.param("id"), c.req.header("if-match") ?? "");
      if (result.status === "rotated") return c.json({ id: result.id, secret: result.secret, version: result.version }, 201);
      return c.json({ id: result.id, status: "replayed" }, 200);
    } catch { return c.json({ error: "Webhook rotation unavailable or request conflict" }, 409); }
  });
  return api;
}

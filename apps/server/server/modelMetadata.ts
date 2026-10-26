import { Hono } from "hono";
import { getResolvedModelCapabilities } from "../src/lib/modelCapabilities.ts";
import { getModelContextOverrideRecord, setModelContextOverride, removeModelContextOverride } from "../src/lib/db/modelContextOverrides.ts";
import { getBooleanModelCapabilityOverrides, setModelCapabilityOverride, removeModelCapabilityOverride } from "../src/lib/db/modelCapabilityOverrides.ts";
import { getDbInstance } from "../src/lib/db/core.ts";

export type ModelMetadataEnv = { Bindings: { peerAddress?: string } };
const fields = ["supportsThinking", "supportsVision", "supportsTools"] as const;

function modelMetadata(provider: string, modelId: string) {
  const capabilities = getResolvedModelCapabilities({ provider, model: modelId });
  const booleanOverrides = getBooleanModelCapabilityOverrides(provider, modelId);
  return {
    provider, modelId,
    contextWindow: capabilities.contextWindow ?? 1_000_000,
    supportsThinking: capabilities.reasoning,
    supportsVision: capabilities.supportsVision ?? false,
    supportsTools: capabilities.toolCalling,
    overrides: { contextWindow: getModelContextOverrideRecord(provider, modelId)?.realContext ?? null, ...Object.fromEntries(fields.map(key => [key, booleanOverrides[key] ?? null])) },
  };
}

export function createModelMetadataApi() {
  const app = new Hono<ModelMetadataEnv>();
  // When mounted under styx.ts, requireAuth already enforces a valid dashboard
  // session cookie + same-origin check on writes. When invoked standalone in
  // unit tests without a session cookie, fall back to the direct-loopback guard.
  app.use("*", async (c, next) => {
    const { hasSession } = await import("./auth.ts");
    const authed = await hasSession(c);
    const origin = c.req.header("origin");
    const url = new URL(c.req.url);
    const host = c.req.header("x-forwarded-host") ?? c.req.header("host") ?? url.host;
    let originMismatch = false;
    if (origin) {
      try {
        originMismatch = new URL(origin).host !== host;
      } catch {
        originMismatch = true;
      }
    }
    if (authed) {
      if (originMismatch || c.req.header("sec-fetch-site") === "cross-site") {
        return c.json({ error: "Cross-origin model editing request refused." }, 403);
      }
      await next();
      return;
    }
    const peer = c.env?.peerAddress;
    const forwarded = [...c.req.raw.headers.keys()].some(key => key === "forwarded" || key.startsWith("x-forwarded-") || key === "x-real-ip");
    const loopbackHost = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(peer ?? "") || forwarded || !loopbackHost || (origin && origin !== url.origin) || c.req.header("sec-fetch-site") === "cross-site") {
      return c.json({ error: "Model editing requires an authenticated session or direct loopback connection." }, 403);
    }
    await next();
  });
  app.get("/", c => {
    const provider = c.req.query("provider");
    const modelId = c.req.query("modelId");
    if (!provider?.trim() || !modelId?.trim()) return c.json({ error: "provider and modelId required" }, 400);
    return c.json({ model: modelMetadata(provider, modelId) });
  });
  app.patch("/", async c => {
    if (!c.req.header("content-type")?.startsWith("application/json")) return c.json({ error: "JSON required" }, 415);
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return c.json({ error: "Invalid JSON object" }, 400);
    const { provider, modelId } = body;
    if (typeof provider !== "string" || !provider.trim() || provider !== provider.trim() || provider.includes("/") || typeof modelId !== "string" || !modelId.trim() || modelId !== modelId.trim()) return c.json({ error: "provider and modelId required" }, 400);
    if (Object.keys(body).some(key => !["provider", "modelId", "contextWindow", ...fields].includes(key))) return c.json({ error: "Unknown metadata field" }, 400);
    if ("contextWindow" in body && body.contextWindow !== null && (!Number.isSafeInteger(body.contextWindow) || body.contextWindow <= 0)) return c.json({ error: "contextWindow must be a positive integer or null" }, 400);
    if (fields.some(key => key in body && body[key] !== null && typeof body[key] !== "boolean")) return c.json({ error: "Capabilities must be booleans or null" }, 400);
    getDbInstance().transaction(() => {
      if ("contextWindow" in body) {
        if (body.contextWindow === null) removeModelContextOverride(provider, modelId);
        else setModelContextOverride(provider, modelId, body.contextWindow, "manual");
      }
      for (const key of fields) if (key in body) {
        if (body[key] === null) removeModelCapabilityOverride(`${provider}/${modelId}`, key);
        else setModelCapabilityOverride(`${provider}/${modelId}`, key, body[key]);
      }
    })();
    return c.json({ model: modelMetadata(provider, modelId) });
  });
  return app;
}

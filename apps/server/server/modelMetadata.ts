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
  // The panel's auth status is not an authentication boundary. This editor is
  // deliberately direct-loopback only until real dashboard auth is integrated.
  app.use("*", async (c, next) => {
    const peer = c.env?.peerAddress;
    const url = new URL(c.req.url);
    const forwarded = [...c.req.raw.headers.keys()].some(key => key === "forwarded" || key.startsWith("x-forwarded-") || key === "x-real-ip");
    const loopbackHost = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    const origin = c.req.header("origin");
    if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(peer ?? "") || forwarded || !loopbackHost || (origin && origin !== url.origin) || c.req.header("sec-fetch-site") === "cross-site") {
      return c.json({ error: "Model editing requires a direct loopback connection; proxied and remote requests are disabled." }, 403);
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

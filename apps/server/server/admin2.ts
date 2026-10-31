// Admin CRUD batch 2: provider nodes (custom connectors), audit log reader, bulk
// account import, API-key rotation for accounts. Mounted under /api behind the
// session gate. Reuses the DB leaf modules + validation schemas; every write is
// audited like the rest of admin.ts.
import { Hono, type Context } from "hono";
import { z, type ZodTypeAny } from "zod";
import {
  createProviderNode,
  deleteProviderNode,
  getProviderNodeById,
  getProviderNodes,
  updateProviderNode,
  createProviderConnection,
  updateProviderConnection,
  getProviderConnectionById,
} from "../src/lib/db/providers.ts";
import { DuplicateProviderNodePrefixError } from "../src/lib/db/providers/nodes.ts";
import { getAuditLog, countAuditLog, logAuditEvent } from "../src/lib/compliance/index.ts";
import { isReservedProviderPrefix } from "../src/shared/constants/reservedProviderPrefixes.ts";
import { REGISTRY } from "../open-sse/config/providers/index.ts";
import { createKeySchema } from "../src/shared/validation/schemas/keys.ts";
import {
  applyPortableConfigBundle,
  buildPortableConfigBundle,
  decryptConfigBundle,
  encryptConfigBundle,
} from "./configBundle.ts";
import { pruneTelemetryLogs, simulateRoutingDryRun } from "./routingDryRun.ts";
import { createWebhook, deleteWebhook, getWebhook, getWebhooks, recordWebhookDelivery, updateWebhook } from "../src/lib/db/webhooks.ts";
import { WEBHOOK_EVENT_VALUES } from "../src/lib/webhooks/eventDescriptions.ts";
import { deliverStoredWebhook } from "../src/lib/webhookDispatcher.ts";
import { clearAllModelLockouts, getModelLockoutSize } from "../open-sse/services/accountFallback.ts";
import { getProxyConfig, setProxyForLevel } from "../src/lib/db/settings.ts";

const audit = (action: string, target: string, details?: unknown) =>
  logAuditEvent({ action, actor: "admin", target, details, resourceType: "admin_api", status: "success" });

function validateBody<S extends ZodTypeAny>(schema: S, body: unknown):
  | { success: true; data: z.infer<S> }
  | { success: false; error: { message: string; details: { field: string; message: string }[] } } {
  const r = schema.safeParse(body ?? {});
  if (r.success) return { success: true, data: r.data };
  return {
    success: false,
    error: { message: "Invalid request", details: r.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })) },
  };
}
const isValidationFailure = (v: { success: boolean }): v is { success: false; error: any } => !v.success;
const bodyOf = (c: Context) => c.req.json().catch(() => undefined);
const bad = (c: Context, error: unknown, status: 400 | 409 = 400) => c.json({ error }, status);
const notFound = (c: Context, what: string) => c.json({ error: `${what} not found` }, 404);

// Prefix rules mirror the runtime resolver: a node prefix must not shadow a
// built-in registry id/alias (requests like <prefix>/model would always land on
// the built-in), and OpenAI-compatible nodes need their api type.
const nodePrefixReserved = (prefix: string) => isReservedProviderPrefix(prefix);

const createNodeSchema = z
  .object({
    type: z.enum(["openai-compatible", "anthropic-compatible"]),
    name: z.string().trim().min(1).max(200),
    prefix: z.string().trim().min(1).max(100),
    apiType: z
      .enum(["chat", "responses", "embeddings", "rerank", "audio-transcriptions", "audio-speech", "images-generations"])
      .optional(),
    baseUrl: z.string().trim().min(1).max(2000),
    chatPath: z.string().trim().startsWith("/").max(500).optional().or(z.literal("")).nullable(),
    modelsPath: z.string().trim().startsWith("/").max(500).optional().or(z.literal("")).nullable(),
    iconUrl: z.string().trim().url().max(1000).optional().or(z.literal("")).nullable(),
    customHeaders: z.record(z.string(), z.string()).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (nodePrefixReserved(v.prefix)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `"${v.prefix}" is reserved — requests like ${v.prefix}/model would always route to the built-in provider`,
        path: ["prefix"],
      });
    }
    if (v.type === "openai-compatible" && !v.apiType) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "apiType is required for OpenAI-compatible nodes", path: ["apiType"] });
    }
  });

const updateNodeSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    prefix: z.string().trim().min(1).max(100).optional(),
    apiType: z
      .enum(["chat", "responses", "embeddings", "rerank", "audio-transcriptions", "audio-speech", "images-generations"])
      .optional(),
    baseUrl: z.string().trim().min(1).max(2000).optional(),
    chatPath: z.string().trim().startsWith("/").max(500).optional().or(z.literal("")).nullable(),
    modelsPath: z.string().trim().startsWith("/").max(500).optional().or(z.literal("")).nullable(),
    iconUrl: z.string().trim().url().max(1000).optional().or(z.literal("")).nullable(),
    customHeaders: z.record(z.string(), z.string()).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });

const nodeView = (n: any) => ({
  id: n.id,
  type: n.type,
  name: n.name,
  prefix: n.prefix ?? null,
  apiType: n.apiType ?? null,
  baseUrl: n.baseUrl ?? null,
  chatPath: n.chatPath ?? null,
  modelsPath: n.modelsPath ?? null,
  iconUrl: n.iconUrl ?? null,
  customHeaders: n.customHeaders ?? null,
  createdAt: n.createdAt ?? null,
  updatedAt: n.updatedAt ?? null,
});

// Bulk import: one provider:key (or provider|key|name) per line. Existing rows
// are skipped, not overwritten — a re-paste of the same list is idempotent.
const bulkSchema = z.object({
  provider: z.string().trim().min(1).max(100),
  lines: z.array(z.string().min(1).max(4000)).min(1).max(500),
});

// Account API-key rotation: swap the stored key without losing the row's
// identity (name/priority/history) the way delete+re-add does.
const rotateSchema = z.object({ apiKey: z.string().trim().min(8).max(4000) }).strict();

export function createAdminApi2() {
  const api = new Hono();

  // ── Provider nodes (custom connectors) ───────────────────────────────────
  api.get("/provider-nodes", async (c) => {
    const nodes = (await getProviderNodes()) as any[];
    return c.json({ nodes: nodes.map(nodeView) });
  });

  api.post("/provider-nodes", async (c) => {
    const v = validateBody(createNodeSchema, await bodyOf(c));
    if (isValidationFailure(v)) return bad(c, v.error);
    let node;
    try { node = await createProviderNode(v.data as never); }
    catch (error) { if (error instanceof DuplicateProviderNodePrefixError) return bad(c, error.message, 409); throw error; }
    audit("providerNode.create", String(node.id), { name: v.data.name, prefix: v.data.prefix });
    return c.json({ node: nodeView(node) }, 201);
  });

  api.patch("/provider-nodes/:id", async (c) => {
    const id = c.req.param("id");
    const v = validateBody(updateNodeSchema, await bodyOf(c));
    if (isValidationFailure(v)) return bad(c, v.error);
    if (v.data.prefix && nodePrefixReserved(v.data.prefix)) {
      return bad(c, `"${v.data.prefix}" is reserved`);
    }
    let node;
    try { node = await updateProviderNode(id, v.data as never); }
    catch (error) { if (error instanceof DuplicateProviderNodePrefixError) return bad(c, error.message, 409); throw error; }
    if (!node) return notFound(c, "Provider node");
    audit("providerNode.update", id, { fields: Object.keys(v.data) });
    return c.json({ node: nodeView(node) });
  });

  api.delete("/provider-nodes/:id", async (c) => {
    const id = c.req.param("id");
    const existing = await getProviderNodeById(id);
    if (!existing) return notFound(c, "Provider node");
    await deleteProviderNode(id);
    audit("providerNode.delete", id, { name: (existing as any).name });
    return c.json({ success: true });
  });

  // ── Audit log reader ─────────────────────────────────────────────────────
  api.get("/audit-log", (c) => {
    const limit = Math.max(1, Math.min(500, Number(c.req.query("limit") ?? 100)));
    const offset = Math.max(0, Number(c.req.query("offset") ?? 0));
    const action = c.req.query("action")?.trim() || undefined;
    const actor = c.req.query("actor")?.trim() || undefined;
    const target = c.req.query("target");
    if (target !== undefined && !target.trim()) return bad(c, "Invalid target");
    const entries = getAuditLog({ limit, offset, action, actor, target });
    return c.json({ entries, total: countAuditLog({ action, actor, target }) });
  });

  // ── Bulk account import ──────────────────────────────────────────────────
  api.post("/connections/bulk", async (c) => {
    const v = validateBody(bulkSchema, await bodyOf(c));
    if (isValidationFailure(v)) return bad(c, v.error);
    const { provider, lines } = v.data;
    const entry = (REGISTRY as Record<string, any>)[provider];
    let providerSpecificData: Record<string, unknown> | undefined;
    if (entry && entry.id === provider) {
      const modes: string[] = Array.isArray(entry.authModes) ? entry.authModes : [entry.authType];
      if (!modes.includes("apikey")) return bad(c, "Provider does not use an API key");
    } else {
      const node = (await getProviderNodeById(provider)) as any;
      if (!node) return bad(c, "Unknown provider");
      providerSpecificData = {
        prefix: node.prefix ?? undefined,
        apiType: node.apiType ?? undefined,
        baseUrl: node.baseUrl ?? undefined,
        nodeName: node.name ?? undefined,
        chatPath: node.chatPath ?? undefined,
        modelsPath: node.modelsPath ?? undefined,
        ...(node.customHeaders ? { customHeaders: node.customHeaders } : {}),
      };
    }

    // Names are untrusted too: a pasted key can appear in any entry's name.
    const keys = lines.map((raw) => (raw.includes("|") && raw.indexOf("|") > 0 ? raw.slice(0, raw.indexOf("|")) : raw).trim()).filter(Boolean);
    const safeName = (name: string) => !keys.some((key) => name.includes(key));
    const created: { id: string; name: string | null }[] = [];
    const skipped: { line: string; reason: string }[] = [];
    for (const raw of lines) {
      // "key" | "key|name" | "name:key" (only when the key half looks like a key)
      let key = raw.trim();
      let name: string | undefined;
      const pipe = raw.indexOf("|");
      if (pipe > 0) {
        key = raw.slice(0, pipe).trim();
        name = raw.slice(pipe + 1).trim() || undefined;
      }
      try {
        const conn = (await createProviderConnection({
          provider,
          authType: "apikey",
          name: name && safeName(name) ? name : `Imported account ${created.length + 1}`,
          apiKey: key,
          isActive: true,
          ...(providerSpecificData ? { providerSpecificData } : {}),
        })) as any;
        created.push({ id: conn.id, name: typeof conn.name === "string" && safeName(conn.name) ? conn.name : null });
      } catch (e) {
        // Neither the submitted line nor an arbitrary persistence error is safe to echo.
        skipped.push({ line: "[redacted]", reason: "Could not import this credential" });
      }
    }
    audit("connection.bulkCreate", provider, { created: created.length, skipped: skipped.length });
    return c.json({ created, skipped }, 201);
  });

  // ── Rotate an account's API key in place ────────────────────────────────
  api.post("/connections/:id/rotate-key", async (c) => {
    const id = c.req.param("id");
    const v = validateBody(rotateSchema, await bodyOf(c));
    if (isValidationFailure(v)) return bad(c, v.error);
    const conn: any = await getProviderConnectionById(id);
    if (!conn) return notFound(c, "Connection");
    if (conn.authType !== "apikey" && conn.authType !== "api_key") {
      return bad(c, "Only API-key accounts can rotate their key here");
    }
    const ok = await updateProviderConnection(id, {
      apiKey: v.data.apiKey,
      testStatus: "active",
      lastError: null,
      lastErrorAt: null,
    });
    if (!ok) return notFound(c, "Connection");
    audit("connection.rotateKey", id);
    return c.json({ success: true });
  });

  // ── Passphrase-encrypted portable configuration export & import (P8) ────
  const exportBundleSchema = z
    .object({
      passphrase: z.string().min(12, "Passphrase must be at least 12 characters").max(200),
    })
    .strict();

  api.post("/config-bundle/export", async (c) => {
    c.header("Cache-Control", "no-store");
    const v = validateBody(exportBundleSchema, await bodyOf(c));
    if (isValidationFailure(v)) return bad(c, v.error);
    const payload = await buildPortableConfigBundle();
    const bundle = encryptConfigBundle(payload, v.data.passphrase);
    audit("configBundle.export", "settings", {
      combos: payload.combos.length,
      providerNodes: payload.providerNodes.length,
    });
    return c.json({ bundle });
  });

  const importBundleSchema = z
    .object({
      passphrase: z.string().min(12, "Passphrase must be at least 12 characters").max(200),
      mode: z.enum(["merge", "replace"]).default("merge"),
      bundle: z.unknown(),
    })
    .strict();

  api.post("/config-bundle/import", async (c) => {
    c.header("Cache-Control", "no-store");
    const v = validateBody(importBundleSchema, await bodyOf(c));
    if (isValidationFailure(v)) return bad(c, v.error);
    let decrypted;
    try {
      decrypted = decryptConfigBundle(v.data.bundle, v.data.passphrase);
    } catch {
      return bad(c, "Could not decrypt bundle: invalid passphrase or corrupted envelope");
    }
    const summary = await applyPortableConfigBundle(decrypted, v.data.mode);
    audit("configBundle.import", "settings", { mode: v.data.mode, ...summary });
    return c.json({ success: true, ...summary });
  });

  // ── Routing dry-run simulator & telemetry log pruning ───────────────────
  const dryRunSchema = z
    .object({
      target: z.string().trim().min(1).max(200),
      tag: z.string().trim().max(64).optional().nullable(),
    })
    .strict();

  api.post("/routing/dry-run", async (c) => {
    c.header("Cache-Control", "no-store");
    const v = validateBody(dryRunSchema, await bodyOf(c));
    if (isValidationFailure(v)) return bad(c, v.error);
    const result = await simulateRoutingDryRun(v.data);
    return c.json(result);
  });

  const pruneLogsSchema = z
    .object({
      retentionDays: z.number().int().min(1).max(365).default(14),
      vacuum: z.boolean().default(true),
    })
    .strict();

  api.post("/storage/prune", async (c) => {
    c.header("Cache-Control", "no-store");
    const v = validateBody(pruneLogsSchema, await bodyOf(c));
    if (isValidationFailure(v)) return bad(c, v.error);
    const summary = pruneTelemetryLogs(v.data);
    audit("storage.prune", "database", summary);
    return c.json({ success: true, ...summary });
  });

  // ── Webhook alert subscriptions CRUD (no secret echoed on list/update) ───
  const webhookView = (w: any) => ({
    id: w.id,
    url: w.url,
    kind: w.kind ?? "custom",
    events: Array.isArray(w.events) ? w.events : [],
    enabled: Boolean(w.enabled),
    description: w.description ?? "",
    createdAt: w.created_at ?? null,
    lastTriggeredAt: w.last_triggered_at ?? null,
    lastStatus: w.last_status ?? null,
    failureCount: w.failure_count ?? 0,
  });

  const createWebhookSchema = z
    .object({
      url: z.string().trim().url().max(1000).refine((u) => /^https?:\/\//i.test(u), {
        message: "Webhook URL must start with http:// or https://",
      }),
      kind: z.enum(["slack", "telegram", "discord", "custom"]).default("custom"),
      description: z.string().trim().max(200).optional().default(""),
      events: z.array(z.enum(WEBHOOK_EVENT_VALUES)).min(1).max(10),
    })
    .strict();

  const patchWebhookSchema = z
    .object({
      enabled: z.boolean().optional(),
      description: z.string().trim().max(200).optional(),
      events: z.array(z.enum(WEBHOOK_EVENT_VALUES)).min(1).max(10).optional(),
    })
    .strict()
    .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });

  api.get("/webhooks", (c) => {
    c.header("Cache-Control", "no-store");
    const { webhooks } = getWebhooks({ limit: 100, offset: 0 });
    return c.json({ webhooks: webhooks.map(webhookView) });
  });

  api.post("/webhooks", async (c) => {
    c.header("Cache-Control", "no-store");
    const v = validateBody(createWebhookSchema, await bodyOf(c));
    if (isValidationFailure(v)) return bad(c, v.error);
    const created = createWebhook(v.data);
    audit("webhook.create", created.id, { kind: created.kind, events: created.events });
    return c.json({ webhook: webhookView(created) }, 201);
  });

  api.patch("/webhooks/:id", async (c) => {
    c.header("Cache-Control", "no-store");
    const id = c.req.param("id");
    const v = validateBody(patchWebhookSchema, await bodyOf(c));
    if (isValidationFailure(v)) return bad(c, v.error);
    const updated = updateWebhook(id, v.data);
    if (!updated) return notFound(c, "Webhook");
    audit("webhook.update", id, v.data);
    return c.json({ webhook: webhookView(updated) });
  });

  api.delete("/webhooks/:id", (c) => {
    c.header("Cache-Control", "no-store");
    const id = c.req.param("id");
    if (!deleteWebhook(id)) return notFound(c, "Webhook");
    audit("webhook.delete", id);
    return c.json({ success: true });
  });

  api.post("/webhooks/:id/test", async (c) => {
    c.header("Cache-Control", "no-store");
    const id = c.req.param("id");
    const wh = getWebhook(id);
    if (!wh) return notFound(c, "Webhook");
    const res = await deliverStoredWebhook(
      wh.url,
      {
        event: "test.ping",
        timestamp: new Date().toISOString(),
        data: { message: "Test ping from StyxRouter", webhookId: wh.id },
      },
      wh.secret,
      0,
    );
    recordWebhookDelivery(wh.id, res.status, res.success);
    audit("webhook.test", id, { success: res.success, status: res.status });
    return c.json(res);
  });

  // ── Clear all in-memory process model lockouts ───────────────────────────
  api.post("/process-health/clear-model-locks", (c) => {
    c.header("Cache-Control", "no-store");
    const cleared = getModelLockoutSize();
    clearAllModelLockouts();
    audit("processHealth.clearModelLocks", "process", { cleared });
    return c.json({ success: true, cleared });
  });

  // ── Outbound proxy configuration (global, provider, account) ─────────────
  const redactProxyEntry = (entry: any) => {
    if (!entry || typeof entry !== "object") return null;
    return {
      type: entry.type ?? "http",
      host: entry.host ?? "",
      port: entry.port ?? "",
      username: entry.username ? String(entry.username) : "",
      hasPassword: Boolean(entry.password),
      family: entry.family ?? "auto",
    };
  };

  api.get("/proxies/config", async (c) => {
    c.header("Cache-Control", "no-store");
    const cfg = await getProxyConfig();
    const providers: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(cfg.providers ?? {})) {
      const redacted = redactProxyEntry(v);
      if (redacted) providers[k] = redacted;
    }
    const keys: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(cfg.keys ?? {})) {
      const redacted = redactProxyEntry(v);
      if (redacted) keys[k] = redacted;
    }
    return c.json({
      global: redactProxyEntry(cfg.global),
      providers,
      keys,
    });
  });

  const putProxyConfigSchema = z
    .object({
      level: z.enum(["global", "provider", "key"]),
      id: z.string().trim().min(1).max(200).nullable().optional(),
      proxyUrl: z.string().trim().max(1000).nullable(),
    })
    .strict();

  api.put("/proxies/config", async (c) => {
    c.header("Cache-Control", "no-store");
    const v = validateBody(putProxyConfigSchema, await bodyOf(c));
    if (isValidationFailure(v)) return bad(c, v.error);
    const { level, id, proxyUrl } = v.data;
    if (level !== "global" && !id) return bad(c, "Target id is required for provider or account proxy");

    let parsedProxy: Record<string, unknown> | null = null;
    if (proxyUrl) {
      try {
        const u = new URL(proxyUrl);
        const proto = u.protocol.replace(":", "").toLowerCase();
        if (!["http", "https", "socks5", "socks5h"].includes(proto) || !u.hostname) {
          return bad(c, "Proxy URL must use http://, https://, or socks5://");
        }
        parsedProxy = {
          type: proto === "socks5h" ? "socks5" : proto,
          host: u.hostname,
          port: u.port || (proto.startsWith("socks") ? "1080" : proto === "https" ? "443" : "8080"),
          username: u.username ? decodeURIComponent(u.username) : "",
          password: u.password ? decodeURIComponent(u.password) : "",
          family: "auto",
        };
      } catch {
        return bad(c, "Invalid proxy URL format");
      }
    }

    await setProxyForLevel(level, level === "global" ? null : id ?? null, parsedProxy);
    audit("proxyConfig.update", level === "global" ? "global" : `${level}:${id}`, {
      cleared: parsedProxy === null,
      host: parsedProxy?.host ?? null,
    });
    return c.json({ success: true });
  });

  return api;
}

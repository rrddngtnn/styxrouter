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
import { getAuditLog, countAuditLog, logAuditEvent } from "../src/lib/compliance/index.ts";
import { isReservedProviderPrefix } from "../src/shared/constants/reservedProviderPrefixes.ts";
import { REGISTRY } from "../open-sse/config/providers/index.ts";
import { createKeySchema } from "../src/shared/validation/schemas/keys.ts";

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
    chatPath: z.string().trim().startsWith("/").max(500).optional().or(z.literal("")),
    modelsPath: z.string().trim().startsWith("/").max(500).optional().or(z.literal("")),
    iconUrl: z.string().trim().url().max(1000).optional().or(z.literal("")),
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
    chatPath: z.string().trim().startsWith("/").max(500).optional().or(z.literal("")),
    modelsPath: z.string().trim().startsWith("/").max(500).optional().or(z.literal("")),
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
    const node = await createProviderNode(v.data as never);
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
    const node = await updateProviderNode(id, v.data as never);
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
    const entries = getAuditLog({ limit, offset, action, actor });
    return c.json({ entries, total: countAuditLog({ action, actor }) });
  });

  // ── Bulk account import ──────────────────────────────────────────────────
  api.post("/connections/bulk", async (c) => {
    const v = validateBody(bulkSchema, await bodyOf(c));
    if (isValidationFailure(v)) return bad(c, v.error);
    const { provider, lines } = v.data;
    const entry = (REGISTRY as Record<string, any>)[provider];
    if (!entry || entry.id !== provider) return bad(c, `Unknown provider '${provider}'`);
    const modes: string[] = Array.isArray(entry.authModes) ? entry.authModes : [entry.authType];
    if (!modes.includes("apikey")) return bad(c, `Provider '${provider}' does not use an API key`);

    const created: { id: string; name: string }[] = [];
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
          name: name || `${provider}-${created.length + 1}`,
          apiKey: key,
          isActive: true,
        })) as any;
        created.push({ id: conn.id, name: conn.name });
      } catch (e) {
        skipped.push({ line: raw.slice(0, 40), reason: (e instanceof Error ? e.message : String(e)).slice(0, 120) });
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

  return api;
}

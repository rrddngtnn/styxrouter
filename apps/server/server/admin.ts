// Admin write API: API keys and combos (create / update / delete). Mounted under /api, so the session
// gate in ./auth.ts already applies. Reuses the upstream validation schemas and DB layer.
import { Hono, type Context } from "hono";
import { getConnectionRoutingTags } from "../src/domain/tagRouter.ts";
import {
  getConnectionExcludedModels,
  normalizeExcludedModelPatterns,
} from "../src/domain/connectionModelRules.ts";
import {
  createApiKey,
  deleteApiKey,
  regenerateApiKey,
  revokeApiKey,
  updateApiKeyPermissions,
} from "../src/lib/db/apiKeys.ts";
import {
  createCombo,
  deleteCombo,
  getComboById,
  getComboByName,
  getCombos,
  reorderCombos,
  updateCombo,
} from "../src/lib/db/combos.ts";
import { isConnectionUnavailableToAuxiliaryActivity } from "../src/lib/exclusiveLeaseIsolation.ts";
import { getConsistentMachineId } from "../src/shared/utils/machineId.ts";
import { logAuditEvent } from "../src/lib/compliance/index.ts";
import { z, type ZodTypeAny } from "zod";
import { REGISTRY } from "../open-sse/config/providers/index.ts";
import {
  createProviderConnection,
  deleteProviderConnection,
  getProviderConnectionById,
  getProviderConnections,
  getProviderNodeById,
  releaseProviderConnectionCooldownWithAudit,
  setProviderConnectionActiveWithAudit,
  renameProviderConnectionWithAudit,
  patchProviderConnectionTagsWithAudit,
  updateProviderConnection,
} from "../src/lib/db/providers.ts";
import { cleanupComboConnectionRefs } from "../src/lib/db/combos.ts";
import { getSettings, updateSettings } from "../src/lib/db/settings.ts";
import { updateSettingsSchema } from "../src/shared/validation/settingsSchemas.ts";
import { validateProviderApiKey } from "../src/lib/providers/validation.ts";
import { TOKEN_EXPIRY_BUFFER_MS, getAccessToken, getRefreshLeadMs } from "../open-sse/services/tokenRefresh.ts";
import {
  getAccessToken as getAccessTokenWithProxy,
  updateProviderCredentials,
} from "../src/sse/services/tokenRefresh.ts";
import {
  getStoredManagementPassword,
  hashManagementPassword,
  verifyManagementPassword,
} from "../src/lib/auth/managementPassword.ts";
import { checkLoginGuard, clearAllLoginAttempts, clearLoginAttempts, recordLoginFailure } from "../src/server/auth/loginGuard.ts";
import { clientIp } from "./auth.ts";
import { createKeySchema } from "../src/shared/validation/schemas/keys.ts";
import { createComboSchema, reorderCombosSchema, updateComboSchema } from "../src/shared/validation/schemas/combo.ts";
import { validateCompositeTiersConfig } from "../src/lib/combos/compositeTiers.ts";
import { normalizeComboModels } from "../src/lib/combos/steps.ts";
import { ComboInvariantError } from "../src/lib/combos/invariants.ts";
import { QUOTA_MODEL_PREFIX } from "../src/lib/quota/quotaModelNaming.ts";
import { clampComboDepth, validateComboDAG } from "../open-sse/services/combo.ts";
import { prepareTokenImport, saveTokenImport, tokenImportProviders } from "./tokenImport.ts";
import { getCachedZcodeVersion, getZcodeVersion, getZcodeVersionObservation } from "../open-sse/services/zcodeVersion.ts";
import { getZcodeVersionPin, setZcodeVersionPin } from "../src/lib/db/zcodeVersionPin.ts";
import { getAntigravityVersionPin, setAntigravityVersionPin } from "../src/lib/db/antigravityVersionPin.ts";
import { getCachedAntigravityIdeVersion, getCachedAntigravityCliVersion, getAntigravityVersionObservation, resolveAntigravityIdeVersion, resolveAntigravityCliVersion } from "../open-sse/services/antigravityVersion.ts";

const audit = (c: Context, action: string, target: string, details?: unknown) =>
  logAuditEvent({ action, actor: "admin", target, details, resourceType: "admin_api", status: "success" });

// The upstream helper imports next/server, which this host does not ship; same error shape, no framework.
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

export function createAdminApi() {
  const api = new Hono();

  api.get("/versions/antigravity/:product/status", (c) => {
    const product = c.req.param("product");
    if (product !== "ide" && product !== "cli") return notFound(c, "Product");
    const pinnedVersion = getAntigravityVersionPin(product);
    const cachedVersion = product === "ide" ? getCachedAntigravityIdeVersion() : getCachedAntigravityCliVersion();
    c.header("Cache-Control", "no-store");
    return c.json({ cachedVersion, pinnedVersion, effectiveVersion: pinnedVersion ?? cachedVersion, executionSupported: product === "cli", ...getAntigravityVersionObservation(product) });
  });

  api.get("/versions/antigravity/:product/pin", (c) => {
    const product = c.req.param("product");
    if (product !== "ide" && product !== "cli") return notFound(c, "Product");
    return c.json({ version: getAntigravityVersionPin(product) });
  });
  api.put("/versions/antigravity/:product/pin", async (c) => {
    const product = c.req.param("product");
    if (product !== "ide" && product !== "cli") return notFound(c, "Product");
    const parsed = z.object({ version: z.string().regex(/^\d{1,6}\.\d{1,6}\.\d{1,6}$/).nullable() }).strict().safeParse(await bodyOf(c));
    if (!parsed.success) return bad(c, "Invalid version");
    setAntigravityVersionPin(product, parsed.data.version);
    await audit(c, "version.pin", `antigravity:${product}`, { version: parsed.data.version });
    return c.json({ version: getAntigravityVersionPin(product) });
  });

  api.post("/versions/antigravity/refresh", async (c) => {
    const previous = { ide: getCachedAntigravityIdeVersion(), cli: getCachedAntigravityCliVersion() };
    const [ide, cli] = await Promise.allSettled([
      resolveAntigravityIdeVersion(fetch, true), resolveAntigravityCliVersion(fetch, true),
    ]);
    const versions = { ide: getCachedAntigravityIdeVersion(), cli: getCachedAntigravityCliVersion() };
    if (ide.status === "rejected" || cli.status === "rejected") {
      return c.json({ error: "Version sources unavailable", previous, versions, failed: { ide: ide.status === "rejected", cli: cli.status === "rejected" } }, 502);
    }
    return c.json({ previous, versions, updated: { ide: versions.ide !== previous.ide, cli: versions.cli !== previous.cli } });
  });

  api.get("/versions/zcode/status", (c) => {
    const pinnedVersion = getZcodeVersionPin();
    const cachedVersion = getCachedZcodeVersion();
    const { observedVersion, observedAt } = getZcodeVersionObservation();
    c.header("Cache-Control", "no-store");
    return c.json({ cachedVersion, pinnedVersion, effectiveVersion: pinnedVersion ?? cachedVersion, observedVersion, observedAt });
  });
  api.get("/versions/zcode/pin", (c) => c.json({ version: getZcodeVersionPin() }));
  api.put("/versions/zcode/pin", async (c) => {
    const parsed = z.object({ version: z.string().regex(/^\d{1,6}\.\d{1,6}\.\d{1,6}$/).nullable() }).strict().safeParse(await bodyOf(c));
    if (!parsed.success) return bad(c, "Invalid version");
    setZcodeVersionPin(parsed.data.version);
    await audit(c, "version.pin", "zcode", { version: parsed.data.version });
    return c.json({ version: getZcodeVersionPin() });
  });

  api.post("/versions/zcode/refresh", async (c) => {
    const previousVersion = getCachedZcodeVersion();
    try {
      const version = await getZcodeVersion(true);
      return c.json({ previousVersion, version, updated: version !== previousVersion });
    } catch {
      return c.json({ error: "Version sources unavailable", previousVersion }, 502);
    }
  });

  // ── API keys ──────────────────────────────────────────────────────────────
  api.post("/keys", async (c) => {
    const v = validateBody(createKeySchema, await bodyOf(c));
    if (isValidationFailure(v)) return bad(c, v.error);
    const { name, allowedConnections, noLog, allowUsageCommand, usageLimitEnabled, dailyUsageLimitUsd, weeklyUsageLimitUsd } = v.data;
    // Scopes are not accepted: nothing in this host honours a management-scope key.
    const key = await createApiKey(name, await getConsistentMachineId(), [], { allowedConnections });
    const extra = {
      ...(noLog === true && { noLog: true }),
      ...(allowUsageCommand === true && { allowUsageCommand: true }),
      ...(usageLimitEnabled === true && { usageLimitEnabled: true }),
      ...(dailyUsageLimitUsd != null && { dailyUsageLimitUsd }),
      ...(weeklyUsageLimitUsd != null && { weeklyUsageLimitUsd }),
    };
    if (Object.keys(extra).length) await updateApiKeyPermissions(key.id, extra);
    audit(c, "apiKey.create", key.id, { name });
    return c.json({ id: key.id, name: key.name, key: key.key }, 201); // the only time the full key is shown
  });

  // Editable key settings. Strict on purpose: scopes, bans and expiry stay out of reach of this endpoint.
  const patchKeySchema = z
    .object({
      name: z.string().trim().min(1).max(100),
      isActive: z.boolean(),
      allowedModels: z.array(z.string().min(1).max(200)).max(200),
      allowedConnections: z.array(z.string().min(1).max(200)).max(200),
      noLog: z.boolean(),
      usageLimitEnabled: z.boolean(),
      dailyUsageLimitUsd: z.number().positive().max(1_000_000).nullable(),
      weeklyUsageLimitUsd: z.number().positive().max(1_000_000).nullable(),
      // Recovery only: the reserved marker denies access and cannot grant it.
      allowedQuotas: z.array(z.literal("__quota_access_revoked__")).length(1),
      maxRequestsPerDay: z.number().int().positive().nullable(),
      maxRequestsPerMinute: z.number().int().positive().nullable(),
    })
    .partial()
    .strict()
    .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });

  api.patch("/keys/:id", async (c) => {
    const id = c.req.param("id");
    const v = validateBody(patchKeySchema, await bodyOf(c));
    if (isValidationFailure(v)) return bad(c, v.error);
    // Repair also disables the key: quota checks may have no model to inspect.
    // Never let a simultaneous isActive:true broaden a corrupt key's access.
    const update = v.data.allowedQuotas ? { ...v.data, isActive: false } : v.data;
    if (!(await updateApiKeyPermissions(id, update))) return notFound(c, "Key");
    audit(c, "apiKey.update", id, { fields: Object.keys(v.data) });
    return c.json({ success: true });
  });

  api.post("/keys/:id/regenerate", async (c) => {
    const r = await regenerateApiKey(c.req.param("id"));
    return r ? c.json({ id: r.id, key: r.key }) : notFound(c, "Key"); // regenerateApiKey audits itself
  });

  api.post("/keys/:id/revoke", async (c) => {
    const id = c.req.param("id");
    if (!(await revokeApiKey(id))) return notFound(c, "Key");
    audit(c, "apiKey.revoke", id);
    return c.json({ success: true });
  });

  api.delete("/keys/:id", async (c) => {
    const id = c.req.param("id");
    if (!(await deleteApiKey(id))) return notFound(c, "Key");
    audit(c, "apiKey.delete", id);
    return c.json({ success: true });
  });

  // ── Combos ────────────────────────────────────────────────────────────────
  // Shared by create and update: normalise steps, check tiers, and refuse cycles / excessive depth.
  const checkCombo = (state: any, allCombos: any[]) => {
    const tiers = validateCompositeTiersConfig(state);
    if (tiers.success === false) return (tiers as any).error.message as string;
    try {
      validateComboDAG(state.name, allCombos, new Set(), 0, clampComboDepth(state.config?.maxComboDepth));
    } catch (e) {
      return e instanceof Error ? e.message : "invalid combo graph";
    }
    return null;
  };

  api.post("/routing/combos", async (c) => {
    const v = validateBody(createComboSchema, await bodyOf(c));
    if (isValidationFailure(v)) return bad(c, v.error);
    try {
      const all = (await getCombos()) as any[];
      const input = { ...v.data, models: normalizeComboModels(v.data.models, { comboName: v.data.name, allCombos: all as never }) };
      if (await getComboByName(input.name)) return bad(c, "Combo name already exists");
      const problem = checkCombo(input, [...all, input]);
      if (problem) return bad(c, problem);
      const combo = await createCombo(input as never);
      audit(c, "combo.create", String((combo as any).id), { name: input.name });
      return c.json(combo, 201);
    } catch (e) {
      if (e instanceof ComboInvariantError) return bad(c, e.message);
      throw e;
    }
  });

  // Registered before /:id so "reorder" is not read as an id.
  api.post("/routing/combos/reorder", async (c) => {
    const v = validateBody(reorderCombosSchema, await bodyOf(c));
    if (isValidationFailure(v)) return bad(c, v.error);
    const combos = await reorderCombos(v.data.comboIds);
    audit(c, "combo.reorder", "combos", { count: v.data.comboIds.length });
    return c.json({ combos });
  });

  api.put("/routing/combos/:id", async (c) => {
    const id = c.req.param("id");
    const v = validateBody(updateComboSchema, await bodyOf(c));
    if (isValidationFailure(v)) return bad(c, v.error);
    const current = (await getComboById(id)) as any;
    if (!current) return notFound(c, "Combo");
    if (String(current.name).startsWith(QUOTA_MODEL_PREFIX)) return bad(c, "Quota-share combos are managed automatically", 409);
    try {
      const all = (await getCombos()) as any[];
      const name = v.data.name || current.name;
      const body: any = v.data.models
        ? { ...v.data, models: normalizeComboModels(v.data.models, { comboName: String(name), allCombos: all as never }) }
        : { ...v.data };
      const next = { ...current, ...body, name };
      if (body.name) {
        const clash = await getComboByName(body.name);
        if (clash && clash.id !== id) return bad(c, "Combo name already exists");
      }
      const problem = checkCombo(next, all.map((x) => (x.id === id ? next : x)));
      if (problem) return bad(c, problem);
      const combo = await updateCombo(id, body);
      audit(c, "combo.update", id, { name });
      return c.json(combo);
    } catch (e) {
      if (e instanceof ComboInvariantError) return bad(c, e.message);
      throw e;
    }
  });

  api.delete("/routing/combos/:id", async (c) => {
    const id = c.req.param("id");
    const current = (await getComboById(id)) as any;
    if (!current) return notFound(c, "Combo");
    if (String(current.name).startsWith(QUOTA_MODEL_PREFIX)) return bad(c, "Quota-share combos are managed automatically", 409);
    if (!(await deleteCombo(id))) return notFound(c, "Combo");
    audit(c, "combo.delete", id, { name: current.name });
    return c.json({ success: true });
  });

  // ── Connected accounts ───────────────────────────────────────────────────
  // Metadata only: the column list keeps credential columns out of the query altogether.
  const CONNECTION_COLUMNS = [
    "id", "provider", "auth_type", "name", "display_name", "email", "priority", "is_active", "test_status",
    "last_error", "last_error_at", "backoff_level", "rate_limited_until", "token_expires_at", "last_used_at", "provider_specific_data",
  ];
  const connectionView = (r: any) => ({
    id: r.id,
    tags: getConnectionRoutingTags(r.providerSpecificData ?? r.provider_specific_data),
    excludedModels: getConnectionExcludedModels(r.providerSpecificData ?? r.provider_specific_data),
    provider: r.provider,
    authType: r.auth_type ?? r.authType,
    name: r.name || r.display_name || null,
    email: r.email ?? null,
    priority: r.priority ?? null,
    isActive: Boolean(r.is_active ?? r.isActive),
    testStatus: r.test_status ?? r.testStatus ?? null,
    lastError: r.last_error ?? r.lastError ?? null,
    lastErrorAt: r.last_error_at ?? r.lastErrorAt ?? null,
    backoffLevel: r.backoff_level ?? r.backoffLevel ?? 0,
    rateLimitedUntil: r.rate_limited_until ?? r.rateLimitedUntil ?? null,
    tokenExpiresAt: r.token_expires_at ?? r.tokenExpiresAt ?? null,
    lastUsedAt: r.last_used_at ?? r.lastUsedAt ?? null,
  });

  api.get("/connections", async (c) => {
    const tags = new URL(c.req.url).searchParams.getAll("tag");
    if (tags.length > 1 || (tags.length === 1 && (!tags[0].trim() || tags[0].trim().length > 64))) {
      return bad(c, "Invalid tag filter");
    }
    const tag = tags[0]?.trim().toLowerCase();
    const rows = (await getProviderConnections({}, undefined, undefined, CONNECTION_COLUMNS)) as any[];
    const connections = rows.map(connectionView);
    return c.json({ connections: tag === undefined ? connections : connections.filter((row) => row.tags.includes(tag)) });
  });

  // Import preview never persists credentials. The request is resubmitted for
  // save; no secrets or preview state are retained in the server session.
  api.get("/connections/import/providers", (c) => c.json({ providers: tokenImportProviders() }));
  const readImport = async (c: Context) => {
    const reader = c.req.raw.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 1024 * 1024) { await reader.cancel(); return null; }
        chunks.push(value);
      }
      return prepareTokenImport(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    } catch { return null; }
  };
  api.post("/connections/import/preview", async (c) => {
    c.header("Cache-Control", "no-store");
    const items = await readImport(c);
    return items ? c.json({ results: items.map((item) => item.view) }) : bad(c, "Invalid import request");
  });
  api.post("/connections/import", async (c) => {
    c.header("Cache-Control", "no-store");
    const items = await readImport(c);
    if (!items) return bad(c, "Invalid import request");
    const results = await saveTokenImport(items);
    return c.json({ results });
  });

  const addConnectionSchema = z
    .object({
      provider: z.string().trim().min(1).max(100),
      name: z.string().trim().min(1).max(200),
      apiKey: z.string().trim().min(8).max(2000),
    })
    .strict();

  // API-key accounts only (OAuth accounts are linked through the /api/oauth device flow). The provider
  // must be either a canonical registry id that takes an API key, or a custom provider node id.
  // The DB layer refuses the management password as a key.
  api.post("/connections", async (c) => {
    const v = validateBody(addConnectionSchema, await bodyOf(c));
    if (isValidationFailure(v)) return bad(c, v.error);
    const { provider, name, apiKey } = v.data;
    const entry = (REGISTRY as Record<string, any>)[provider];
    let providerSpecificData: Record<string, unknown> | undefined;
    if (entry && entry.id === provider) {
      const modes: string[] = Array.isArray(entry.authModes) ? entry.authModes : [entry.authType];
      if (!modes.includes("apikey")) return bad(c, `Provider '${provider}' does not use an API key`);
    } else {
      const node = (await getProviderNodeById(provider)) as any;
      if (!node) return bad(c, `Unknown provider '${provider}'`);
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
    try {
      const conn = (await createProviderConnection({
        provider,
        authType: "apikey",
        name,
        apiKey,
        isActive: true,
        ...(providerSpecificData ? { providerSpecificData } : {}),
      })) as any;
      audit(c, "connection.create", String(conn.id), { provider, name });
      return c.json({ id: conn.id, provider, name }, 201);
    } catch (e) {
      return bad(c, e instanceof Error ? e.message : "could not create the account");
    }
  });

  const bulkTagsSchema = z.object({
    ids: z.array(z.string().min(1).max(200)).min(1).max(100).refine(ids => new Set(ids).size === ids.length),
    operation: z.enum(["add", "remove", "replace"]),
    tags: z.array(z.string().trim().min(1).max(64)).max(50),
  }).strict();
  api.post("/connections/bulk-tags", async (c) => {
    const parsed = validateBody(bulkTagsSchema, await bodyOf(c));
    if (isValidationFailure(parsed)) return bad(c, parsed.error);
    const results = parsed.data.ids.map(id => {
      try { return { id, ...patchProviderConnectionTagsWithAudit(id, parsed.data.operation, parsed.data.tags) }; }
      catch { return { id, success: false, error: "Could not update tags" }; }
    });
    return c.json({ results });
  });

  // Rename only the explicitly selected accounts; individual failures do not stop the batch.
  const bulkRenameSchema = z.object({
    ids: z.array(z.string().min(1).max(200)).min(1).max(100).refine(ids => new Set(ids).size === ids.length),
    pattern: z.string().min(1).max(200),
  }).strict();
  api.post("/connections/bulk-rename", async (c) => {
    const parsed = validateBody(bulkRenameSchema, await bodyOf(c));
    if (isValidationFailure(parsed)) return bad(c, parsed.error);
    const results: Record<string, unknown>[] = [];
    for (const [index, id] of parsed.data.ids.entries()) {
      try {
        results.push({ id, ...renameProviderConnectionWithAudit(id, parsed.data.pattern, index + 1) });
      } catch { results.push({ id, success: false, error: "Could not rename connection" }); }
    }
    return c.json({ results });
  });

  const bulkActivationSchema = z.object({
    ids: z.array(z.string().min(1).max(200)).min(1).max(100).refine(ids => new Set(ids).size === ids.length),
    isActive: z.boolean(),
  }).strict();
  api.post("/connections/bulk-activation", async (c) => {
    const parsed = validateBody(bulkActivationSchema, await bodyOf(c));
    if (isValidationFailure(parsed)) return bad(c, parsed.error);
    const results = parsed.data.ids.map(id => {
      try { return { id, ...setProviderConnectionActiveWithAudit(id, parsed.data.isActive) }; }
      catch { return { id, success: false, error: "Could not update connection" }; }
    });
    return c.json({ results });
  });

  const bulkCooldownSchema = z.object({
    ids: z.array(z.string().min(1).max(200)).min(1).max(100).refine(ids => new Set(ids).size === ids.length),
  }).strict();
  api.post("/connections/bulk-release-cooldown", async (c) => {
    const parsed = validateBody(bulkCooldownSchema, await bodyOf(c));
    if (isValidationFailure(parsed)) return bad(c, parsed.error);
    const results: Record<string, unknown>[] = [];
    for (const id of parsed.data.ids) {
      try {
        results.push({ id, ...releaseProviderConnectionCooldownWithAudit(id) });
      } catch {
        results.push({ id, success: false, error: "Could not release cooldown" });
      }
    }
    return c.json({ results });
  });

  // Strict: secrets (apiKey, tokens) are not editable here, a stray key is a 400.
  const patchConnectionSchema = z
    .object({
      isActive: z.boolean().optional(),
      name: z.string().trim().min(1).max(200).optional(),
      priority: z.number().int().min(0).max(100000).optional(),
      excludedModels: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
    })
    .strict();

  api.patch("/connections/:id", async (c) => {
    const id = c.req.param("id");
    const v = validateBody(patchConnectionSchema, await bodyOf(c));
    if (isValidationFailure(v)) return bad(c, v.error);
    const { excludedModels, ...rest } = v.data;
    const updatePayload: Record<string, unknown> = { ...rest };
    if (excludedModels !== undefined) {
      const existing = (await getProviderConnectionById(id)) as any;
      if (!existing) return notFound(c, "Connection");
      const prevPsd =
        existing.providerSpecificData && typeof existing.providerSpecificData === "object"
          ? existing.providerSpecificData
          : {};
      updatePayload.providerSpecificData = {
        ...prevPsd,
        excludedModels: normalizeExcludedModelPatterns(excludedModels),
      };
    }
    if (!(await updateProviderConnection(id, updatePayload))) return notFound(c, "Connection");
    audit(c, "connection.update", id, v.data);
    return c.json({ success: true });
  });

  api.post("/connections/:id/release-cooldown", async (c) => {
    const id = c.req.param("id");
    const result = releaseProviderConnectionCooldownWithAudit(id, false);
    if (!result.success) return notFound(c, "Connection");
    return c.json({ success: true });
  });

  api.delete("/connections/:id", async (c) => {
    const id = c.req.param("id");
    if (!(await getProviderConnectionById(id))) return notFound(c, "Connection");
    await deleteProviderConnection(id);
    await cleanupComboConnectionRefs(id);
    audit(c, "connection.delete", id);
    return c.json({ success: true });
  });

  // API-key accounts: ask the provider whether the key still works. OAuth accounts: refresh the token
  // only when it is due (the same rule the token-health pass uses), never forcing a single-use rotation.
  api.post("/connections/:id/test", async (c) => {
    const id = c.req.param("id");
    const conn = (await getProviderConnectionById(id)) as any;
    if (!conn) return notFound(c, "Connection");
    let ok = false;
    let error: string | null = null;
    try {
      if (conn.authType === "oauth") {
        const rawExp = conn.tokenExpiresAt ?? conn.expiresAt ?? null;
        const expiresAt = rawExp ? new Date(rawExp).getTime() : null;
        const due = expiresAt !== null && Date.now() >= expiresAt - getRefreshLeadMs(conn.provider) - TOKEN_EXPIRY_BUFFER_MS;
        if (conn.providerSpecificData?.importedToken &&
            (conn.testStatus === "expired" || (expiresAt !== null && Date.now() >= expiresAt))) {
          error = "Token expired; re-import or re-authenticate";
        } else if (!due || conn.providerSpecificData?.importedToken) {
          ok = conn.testStatus === "active" || !conn.testStatus;
          if (!ok) error = conn.lastError || `Account status is ${conn.testStatus}`;
        } else {
          const log = { warn: () => {}, error: () => {} };
          const r = await getAccessToken(
            conn.provider,
            { refreshToken: conn.refreshToken, connectionId: id, accessToken: conn.accessToken, expiresAt: rawExp, providerSpecificData: conn.providerSpecificData },
            log,
            null,
            async (persisted) => { if (!(await updateProviderCredentials(id, persisted as Record<string, unknown>))) throw new Error("Secure credential persistence failed"); }
          );
          ok = Boolean(r?.accessToken);
          if (!ok) error = "token refresh failed";
        }
      } else {
        const r: any = await validateProviderApiKey({ provider: conn.provider, apiKey: conn.apiKey, providerSpecificData: conn.providerSpecificData });
        ok = Boolean(r?.valid);
        if (!ok) error = String(r?.error ?? "key rejected").slice(0, 200);
      }
    } catch (e) {
      error = (e instanceof Error ? e.message : "test failed").slice(0, 200);
    }
    await updateProviderConnection(id, { testStatus: ok ? "active" : error === "Token expired; re-import or re-authenticate" ? "expired" : "error", lastTested: new Date().toISOString() });
    audit(c, "connection.test", id, { ok });
    return c.json({ ok, error });
  });

  // Explicit manual OAuth token renewal requested by the operator from the panel.
  api.post("/connections/:id/refresh-token", async (c) => {
    const id = c.req.param("id");
    const conn = (await getProviderConnectionById(id)) as any;
    if (!conn) return notFound(c, "Connection");
    if (conn.authType !== "oauth") {
      return bad(c, "Only OAuth accounts support token refresh.");
    }
    if (conn.isActive === false) {
      return bad(c, "Enable this account before refreshing its token.", 409);
    }
    if (!conn.refreshToken || typeof conn.refreshToken !== "string") {
      return bad(c, "No refresh token stored for this account; re-authenticate via OAuth.");
    }
    if (conn.providerSpecificData?.importedToken) {
      return bad(c, "Imported static token refresh is disabled; re-authenticate via OAuth.");
    }
    try {
      if (await isConnectionUnavailableToAuxiliaryActivity(id)) {
        return bad(c, "Token refresh deferred while this account is exclusively reserved or leased.", 409);
      }
      // Keep the helper's credential object: its staleness check may adopt a
      // newer expired DB token before refreshing. CAS against that actual input,
      // not the older HTTP snapshot (and never arbitrary current credentials).
      const refreshCredentials = {
        refreshToken: conn.refreshToken,
        connectionId: id,
        accessToken: conn.accessToken,
        expiresAt: conn.tokenExpiresAt ?? conn.expiresAt ?? null,
        providerSpecificData: conn.providerSpecificData,
      };
      const r: any = await getAccessTokenWithProxy(
        conn.provider,
        refreshCredentials,
        async (persisted) => {
          const current = (await getProviderConnectionById(id)) as any;
          if (!current || current.isActive === false || current.providerSpecificData?.importedToken ||
              current.provider !== conn.provider || current.authType !== "oauth" ||
              (current.refreshToken !== refreshCredentials.refreshToken && current.refreshToken !== persisted.refreshToken) ||
              await isConnectionUnavailableToAuxiliaryActivity(id)) {
            throw new Error("Connection changed during refresh");
          }
          if (!(await updateProviderCredentials(id, persisted as Record<string, unknown>))) {
            throw new Error("Secure credential persistence failed");
          }
        },
      );
      if (!r?.accessToken) {
        // Upstream codes and exception messages are untrusted credential-bearing text.
        const errMsg = "OAuth token refresh failed; re-authenticate if the problem persists.";
        await updateProviderConnection(id, {
          testStatus: "error",
          lastError: errMsg,
          lastTested: new Date().toISOString(),
        });
        audit(c, "connection.refresh_token", id, { ok: false, error: errMsg });
        return c.json({ ok: false, error: errMsg }, 400);
      }
      const updated = (await getProviderConnectionById(id)) as any;
      const tokenExpiresAt = updated?.tokenExpiresAt ?? updated?.expiresAt ?? null;
      audit(c, "connection.refresh_token", id, { ok: true, tokenExpiresAt });
      return c.json({ ok: true, tokenExpiresAt });
    } catch {
      const error = "OAuth token refresh failed; credentials were not confirmed persisted.";
      audit(c, "connection.refresh_token", id, { ok: false, error });
      return c.json({ ok: false, error }, 400);
    }
  });

  // ── Settings and the management password ─────────────────────────────────
  api.patch("/settings", async (c) => {
    // .strict(): the upstream schema silently drops unknown keys, which would turn a typo into a 200 that changed nothing.
    const v = validateBody(updateSettingsSchema.strict(), await bodyOf(c));
    if (isValidationFailure(v)) return bad(c, v.error);
    const { newPassword, currentPassword, expectedRevision, ...changes } = v.data as Record<string, any>;
    if (newPassword !== undefined || currentPassword !== undefined) return bad(c, "Change the password with POST /api/auth/password");
    try {
      const { password: _hash, oidcClientSecret: _s, ...settings } = (await updateSettings(changes, { expectedRevision })) as Record<string, unknown>;
      audit(c, "settings.update", "settings", { keys: Object.keys(changes) });
      return c.json(settings);
    } catch (e) {
      if (e instanceof Error && /revision/i.test(e.message)) return bad(c, e.message, 409);
      throw e;
    }
  });

  const passwordSchema = z.object({
    currentPassword: z.string().min(1).max(200),
    newPassword: z.string().min(12, "use at least 12 characters").max(200),
  });

  // Existing sessions stay valid until their cookie expires; rotate JWT_SECRET to end them all.
  api.post("/auth/password", async (c) => {
    const v = validateBody(passwordSchema, await bodyOf(c));
    if (isValidationFailure(v)) return bad(c, v.error);
    const ip = clientIp(c);
    const guard = checkLoginGuard(ip, { enabled: true });
    if (!guard.allowed) return c.json({ error: "Too many failed attempts. Try again later." }, 429);
    const hash = getStoredManagementPassword((await getSettings()) as any);
    if (!hash || !(await verifyManagementPassword(v.data.currentPassword, hash))) {
      recordLoginFailure(ip, { enabled: true });
      return c.json({ error: "Current password is wrong" }, 401);
    }
    clearLoginAttempts(ip);
    clearAllLoginAttempts();
    await updateSettings({ password: await hashManagementPassword(v.data.newPassword) });
    audit(c, "auth.password.change", "management");
    return c.json({ success: true });
  });

  return api;
}

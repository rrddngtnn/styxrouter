// Admin write API: API keys and combos (create / update / delete). Mounted under /api, so the session
// gate in ./auth.ts already applies. Reuses the upstream validation schemas and DB layer.
import { Hono, type Context } from "hono";
import {
  createApiKey,
  deleteApiKey,
  getApiKeyById,
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
import { getConsistentMachineId } from "../src/shared/utils/machineId.ts";
import { logAuditEvent } from "../src/lib/compliance/index.ts";
import { z, type ZodTypeAny } from "zod";
import { REGISTRY } from "../open-sse/config/providers/index.ts";
import {
  createProviderConnection,
  deleteProviderConnection,
  getProviderConnectionById,
  getProviderConnections,
  resetConnectionBackoff,
  updateProviderConnection,
} from "../src/lib/db/providers.ts";
import { cleanupComboConnectionRefs } from "../src/lib/db/combos.ts";
import { getSettings, updateSettings } from "../src/lib/db/settings.ts";
import { updateSettingsSchema } from "../src/shared/validation/settingsSchemas.ts";
import { validateProviderApiKey } from "../src/lib/providers/validation.ts";
import { TOKEN_EXPIRY_BUFFER_MS, getAccessToken, getRefreshLeadMs } from "../open-sse/services/tokenRefresh.ts";
import { updateProviderCredentials } from "../src/sse/services/tokenRefresh.ts";
import {
  getStoredManagementPassword,
  hashManagementPassword,
  verifyManagementPassword,
} from "../src/lib/auth/managementPassword.ts";
import { checkLoginGuard, clearLoginAttempts, recordLoginFailure } from "../src/server/auth/loginGuard.ts";
import { clientIp } from "./auth.ts";
import { createKeySchema } from "../src/shared/validation/schemas/keys.ts";
import { createComboSchema, reorderCombosSchema, updateComboSchema } from "../src/shared/validation/schemas/combo.ts";
import { validateCompositeTiersConfig } from "../src/lib/combos/compositeTiers.ts";
import { normalizeComboModels } from "../src/lib/combos/steps.ts";
import { ComboInvariantError } from "../src/lib/combos/invariants.ts";
import { QUOTA_MODEL_PREFIX } from "../src/lib/quota/quotaModelNaming.ts";
import { clampComboDepth, validateComboDAG } from "../open-sse/services/combo.ts";

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
    if (!(await getApiKeyById(id))) return notFound(c, "Key");
    await updateApiKeyPermissions(id, v.data);
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
    "last_error", "last_error_at", "backoff_level", "rate_limited_until", "token_expires_at", "last_used_at",
  ];
  const connectionView = (r: any) => ({
    id: r.id,
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
    const rows = (await getProviderConnections({}, undefined, undefined, CONNECTION_COLUMNS)) as any[];
    return c.json({ connections: rows.map(connectionView) });
  });

  const addConnectionSchema = z
    .object({
      provider: z.string().trim().min(1).max(100),
      name: z.string().trim().min(1).max(200),
      apiKey: z.string().trim().min(8).max(2000),
    })
    .strict();

  // API-key accounts only (OAuth accounts are linked through the /api/oauth device flow). The provider
  // must be a canonical registry id that takes an API key; the DB layer refuses the management password as a key.
  api.post("/connections", async (c) => {
    const v = validateBody(addConnectionSchema, await bodyOf(c));
    if (isValidationFailure(v)) return bad(c, v.error);
    const { provider, name, apiKey } = v.data;
    const entry = (REGISTRY as Record<string, any>)[provider];
    if (!entry || entry.id !== provider) return bad(c, `Unknown provider '${provider}'`);
    const modes: string[] = Array.isArray(entry.authModes) ? entry.authModes : [entry.authType];
    if (!modes.includes("apikey")) return bad(c, `Provider '${provider}' does not use an API key`);
    try {
      const conn = (await createProviderConnection({ provider, authType: "apikey", name, apiKey, isActive: true })) as any;
      audit(c, "connection.create", String(conn.id), { provider, name });
      return c.json({ id: conn.id, provider, name }, 201);
    } catch (e) {
      return bad(c, e instanceof Error ? e.message : "could not create the account");
    }
  });

  // Strict: secrets (apiKey, tokens) are not editable here, a stray key is a 400.
  const patchConnectionSchema = z
    .object({
      isActive: z.boolean().optional(),
      name: z.string().trim().min(1).max(200).optional(),
      priority: z.number().int().min(0).max(100000).optional(),
    })
    .strict();

  api.patch("/connections/:id", async (c) => {
    const id = c.req.param("id");
    const v = validateBody(patchConnectionSchema, await bodyOf(c));
    if (isValidationFailure(v)) return bad(c, v.error);
    if (!(await updateProviderConnection(id, v.data))) return notFound(c, "Connection");
    audit(c, "connection.update", id, v.data);
    return c.json({ success: true });
  });

  api.post("/connections/:id/release-cooldown", async (c) => {
    const id = c.req.param("id");
    if (!(await getProviderConnectionById(id))) return notFound(c, "Connection");
    await resetConnectionBackoff(id);
    await updateProviderConnection(id, { rateLimitedUntil: null });
    audit(c, "connection.release-cooldown", id);
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
        if (!due) {
          ok = conn.testStatus === "active" || !conn.testStatus;
          if (!ok) error = conn.lastError || `Account status is ${conn.testStatus}`;
        } else {
          const log = { warn: () => {}, error: () => {} };
          const r = await getAccessToken(
            conn.provider,
            { refreshToken: conn.refreshToken, connectionId: id, accessToken: conn.accessToken, expiresAt: rawExp, providerSpecificData: conn.providerSpecificData },
            log,
            null,
            async (persisted) => { await updateProviderCredentials(id, persisted as Record<string, unknown>); }
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
    await updateProviderConnection(id, { testStatus: ok ? "active" : "error", lastTested: new Date().toISOString() });
    audit(c, "connection.test", id, { ok });
    return c.json({ ok, error });
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
    await updateSettings({ password: await hashManagementPassword(v.data.newPassword) });
    audit(c, "auth.password.change", "management");
    return c.json({ success: true });
  });

  return api;
}

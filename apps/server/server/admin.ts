// Admin write API: API keys and combos (create / update / delete). Mounted under /api, so the session
// gate in ./auth.ts already applies. Reuses the upstream validation schemas and DB layer.
import { Hono, type Context } from "hono";
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
import { getConsistentMachineId } from "../src/shared/utils/machineId.ts";
import { logAuditEvent } from "../src/lib/compliance/index.ts";
import type { ZodTypeAny, z } from "zod";
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

  return api;
}

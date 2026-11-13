import { Hono } from "hono";
import { SPECIALTY_PROVIDERS } from "./specialty.ts";
const managementRegistry = () => ({ ...SPECIALTY_PROVIDERS, ...REGISTRY });
import { z } from "zod";
import { REGISTRY } from "../open-sse/config/providers/index.ts";
import { FORMATS } from "../open-sse/translator/formats.ts";
import { getProviderConnectionById, getProviderNodeById, getProviderNodes } from "../src/lib/db/providers.ts";
import { addCustomModel, getCustomModels, getSyncedAvailableModelsByConnection, removeCustomModel, updateCustomModel, SYNCED_AVAILABLE_MODELS_MALFORMED, ProviderModelConflict } from "../src/lib/db/models.ts";
import { MODEL_SUPPORTED_ENDPOINT_VALUES, normalizeModelSupportedEndpoints } from "../src/shared/constants/modelSupportedEndpoints.ts";
import { logAuditEvent } from "../src/lib/compliance/index.ts";
import { getModelAliases } from "../src/lib/db/models/aliases.ts";
import { appendClaudeEffortVariants } from "../open-sse/utils/claudeEffortVariants.ts";
import { appendSyncedEffortVariants } from "../open-sse/utils/syncedEffortVariants.ts";
import { EMBEDDING_PROVIDERS } from "../open-sse/config/embeddingRegistry.ts";
import { getAllImageModels } from "../open-sse/config/imageRegistry.ts";
import { getAllRerankModels } from "../open-sse/config/rerankRegistry.ts";
import { getAllAudioModels } from "../open-sse/config/audioRegistry.ts";
import { getAllModerationModels } from "../open-sse/config/moderationRegistry.ts";
import { getAllVideoModels } from "../open-sse/config/videoRegistry.ts";
import { getAllMusicModels } from "../open-sse/config/musicRegistry.ts";

const apiFormats = ["chat-completions", "responses", "embeddings", "rerank", "audio-transcriptions", "audio-speech", "images-generations", "video"] as const;
const idSchema = z.string().min(1).max(200).regex(/^[A-Za-z0-9_][A-Za-z0-9_.:+@-]*(?:\/[A-Za-z0-9_][A-Za-z0-9_.:+@-]*)*$/).refine(id => !id.split("/").some(part => part === "." || part === ".."));
const fields = {
  name: z.string().trim().min(1).max(200).optional(),
  apiFormat: z.enum(apiFormats).optional(),
  targetFormat: z.enum(Object.values(FORMATS) as [string, ...string[]]).optional(),
  supportedEndpoints: z.array(z.enum(MODEL_SUPPORTED_ENDPOINT_VALUES)).min(1).max(16).refine(a => new Set(a).size === a.length).optional(),
};
const tokenLimit = z.number().int().positive().safe();
const capabilityFields = { inputTokenLimit: tokenLimit.optional(), outputTokenLimit: tokenLimit.optional(), supportsVision: z.boolean().optional() };
const createSchema = z.object({ id: idSchema, ...fields, ...capabilityFields }).strict();
const patchSchema = z.object({ ...fields, inputTokenLimit: tokenLimit.nullable().optional(), outputTokenLimit: tokenLimit.nullable().optional(), supportsVision: z.boolean().nullable().optional() }).strict().refine(v => Object.keys(v).length > 0);

type Model = Record<string, any> & { id: string };

type ScopedInventory = { providerId: string; nodeId: string | null; prefix: string; models: Model[] };
export function buildScopedInventoryRows(inventories: ScopedInventory[]) {
  return inventories.flatMap(({ providerId, nodeId, prefix, models }) => models
    .filter(model => model && typeof model.id === "string" && model.id.length > 0)
    .map(model => ({ ...model, id: `${prefix}/${model.id}`, providerId, nodeId, localId: model.id })));
}
export function expandEmbeddingInventory(inventories: ScopedInventory[]) {
  for (const inventory of inventories) {
    if (inventory.nodeId !== null || !Object.hasOwn(EMBEDDING_PROVIDERS, inventory.providerId)) continue;
    const existing = new Set(inventory.models.map(model => model.id));
    for (const model of EMBEDDING_PROVIDERS[inventory.providerId].models) {
      if (existing.has(model.id)) continue;
      existing.add(model.id);
      inventory.models.push({ ...model, origin: "embedding-registry", type: "embedding" });
    }
  }
}
export function expandSpecialtyInventory(inventories: ScopedInventory[]) {
  const sources = [
    ["image-registry", "image", getAllImageModels()], ["rerank-registry", "rerank", getAllRerankModels()],
    ["audio-registry", "audio", getAllAudioModels()], ["moderation-registry", "moderation", getAllModerationModels()],
    ["video-registry", "video", getAllVideoModels()], ["music-registry", "music", getAllMusicModels()],
  ] as const;
  const byProvider = new Map(inventories.filter(i => i.nodeId === null).map(i => [i.providerId, i]));
  for (const [origin, type, models] of sources) for (const model of models) {
    const inventory = byProvider.get(model.provider);
    const prefix = `${model.provider}/`;
    // Bare image aliases do not identify a provider-local routing ID.
    if (!inventory || !model.id.startsWith(prefix)) continue;
    const id = model.id.slice(prefix.length);
    if (!id || inventory.models.some(existing => existing.id === id)) continue;
    inventory.models.push({ ...model, id, origin, type });
  }
}
// Only an unambiguous prefix establishes ownership of an alias target.
export function expandAdminInventories(inventories: ScopedInventory[], aliases: Record<string, unknown>, prefixes: Map<string, string[]>) {
  const byProvider = new Map(inventories.map(i => [i.providerId, i]));
  for (const value of Object.values(aliases)) {
    if (typeof value !== "string" || value !== value.trim()) continue;
    const slash = value.indexOf("/");
    if (slash <= 0 || slash === value.length - 1) continue;
    const owners = prefixes.get(value.slice(0, slash));
    if (!owners || owners.length !== 1) continue;
    const inventory = byProvider.get(owners[0]);
    const id = value.slice(slash + 1);
    if (inventory && !inventory.models.some(m => m.id === id)) inventory.models.push({ id, origin: "alias-backed" });
  }
  for (const inventory of inventories) {
    const existing = new Set(inventory.models.map(m => m.id));
    for (const model of [...inventory.models]) {
      const qualified = { ...model, name: model.name, id: `${inventory.prefix}/${model.id}`, root: model.id, owned_by: inventory.providerId,
        capabilities: model.origin === "synced" && Array.isArray(model.supportedThinkingEfforts) ? { effort_tiers: model.supportedThinkingEfforts } : undefined };
      const variants = [...appendClaudeEffortVariants([qualified]).slice(1), ...appendSyncedEffortVariants([qualified]).slice(1)];
      for (const variant of variants) {
        const localId = variant.id.slice(inventory.prefix.length + 1);
        if (existing.has(localId)) continue;
        existing.add(localId);
        inventory.models.push({ ...model, id: localId, name: variant.name, origin: "generated-effort", baseLocalId: model.id });
      }
    }
  }
  return inventories;
}
async function provider(id: string) {
  const registry = managementRegistry();
  const entry = Object.hasOwn(registry, id) ? registry[id] : undefined;
  if (entry?.id === id) return { id, prefix: entry.alias || id, builtins: entry.models || [] };
  const node = await getProviderNodeById(id) as any;
  return node ? { id, prefix: node.prefix || id, builtins: [] } : null;
}
async function inventory(p: NonNullable<Awaited<ReturnType<typeof provider>>>, allowMalformedSync = false) {
  const [manual, synced] = await Promise.all([getCustomModels(p.id), getSyncedAvailableModelsByConnection(p.id)]);
  const malformedSync = !!synced[SYNCED_AVAILABLE_MODELS_MALFORMED];
  if ((!allowMalformedSync && malformedSync) || !Array.isArray(manual)) throw new Error("Invalid model inventory");
  const rows = new Map<string, Model>();
  for (const model of p.builtins) rows.set(model.id, { ...model, origin: "built-in" });
  for (const models of Object.values(synced)) for (const model of models) {
    if (!rows.has(model.id)) rows.set(model.id, { ...model, origin: "synced" });
  }
  for (const model of manual as Model[]) {
    if (!model || typeof model.id !== "string") continue;
    const manualOrigin = !model.source || model.source === "manual";
    const existing = rows.get(model.id);
    if (!existing) rows.set(model.id, { ...model, origin: manualOrigin ? "manual" : "synced" });
    else if (manualOrigin) rows.set(model.id, { ...existing, manualOverlay: { ...model } });
  }
  return { rows, manual: manual as Model[], malformedSync };
}

// Account catalogs are inventory observations, never entitlement or inference proof.
async function accountInventory(p: NonNullable<Awaited<ReturnType<typeof provider>>>, connectionId: string) {
  const account = await getProviderConnectionById(connectionId) as any;
  if (!account || !account.isActive || account.provider !== p.id) return null;
  const synced = await getSyncedAvailableModelsByConnection(p.id);
  const catalog = synced[connectionId];
  const known = Array.isArray(catalog) && catalog.length > 0;
  const { rows } = await inventory(p, true);
  if (known) for (const row of catalog) if (!rows.has(row.id)) rows.set(row.id, { ...row, origin: "synced" });
  const scoped = { providerId: p.id, nodeId: null, prefix: p.prefix, models: specialtyRows(p, [...rows.values()]) };
  expandAdminInventories([scoped], {}, new Map());
  let models = scoped.models;
  if (known) {
    const { isModelAdvertisedByConnection } = await import("../src/domain/connectionModelRules.ts");
    const { getActiveSyncedCatalog } = await import("../src/lib/db/models/activeSyncedCatalog.ts");
    const active = await getActiveSyncedCatalog(p.id);
    const ids = new Set(catalog.map(m => m.id));
    const activeIds = new Set(active.models.map(m => m.id));
    const isAgy = p.id === "antigravity" || p.id === "agy";
    const { resolveAntigravityWireModel } = await import("../open-sse/services/antigravityModelResolution.ts");
    const eligibility = await Promise.all(models.map(async row => {
      const target = isAgy ? await resolveAntigravityWireModel(row.id, activeIds.has(row.id)) : row.id;
      return isModelAdvertisedByConnection(target, ids, p.id, p.id === "codex" && active.authoritative && activeIds.has(row.id), isAgy);
    }));
    models = models.filter((_, index) => eligibility[index]);
  }
  return { account, models, catalogStatus: known ? "known" : "unknown" };
}

export async function accountProbeCapability(providerId: string, model: string, connectionId?: string) {
  const p = await provider(providerId);
  if (!p || !model.startsWith(`${p.prefix}/`)) return { supported: false, reason: "invalid_inventory" } as const;
  const scoped = connectionId ? await accountInventory(p, connectionId) : null;
  if (connectionId && !scoped) return { supported: false, reason: "account_unavailable" } as const;
  const models = scoped ? scoped.models : specialtyRows(p, [...(await inventory(p)).rows.values()]);
  const row = models.find(row => row.id === model.slice(p.prefix.length + 1));
  if (!row) return { supported: false, reason: "invalid_inventory" } as const;
  const node = await getProviderNodeById(providerId) as any;
  const type = row.type;
  if ((type && type !== "chat" && type !== "text") || (node && node.apiType && !["chat", "responses"].includes(node.apiType))) return { supported: false, reason: "unsupported_model_type" } as const;
  // Ambiguous prefixes must not select a different compatible node.
  if (!(await isExplicitProviderModel(model, !!connectionId))) return { supported: false, reason: "invalid_inventory" } as const;
  try {
    const { getExecutor } = await import("../open-sse/executors/index.ts");
    getExecutor(node ? (node.type === "anthropic-compatible" ? `anthropic-compatible-${node.id}` : `openai-compatible-${node.apiType === "responses" ? "responses" : "chat"}-${node.id}`) : providerId);
  } catch { return { supported: false, reason: "unsupported_provider" } as const; }
  return { supported: true, reason: null } as const;
}

export async function isExplicitProviderModel(model: string, allowMalformedSync = false): Promise<boolean> {
  const slash = model.indexOf("/");
  if (slash < 1) return false;
  const prefix = model.slice(0, slash), localId = model.slice(slash + 1);
  const candidates = Object.entries(managementRegistry())
    .filter(([id, entry]) => entry.id === id && (id === prefix || entry.alias === prefix))
    .map(([id, entry]) => ({ id, prefix, builtins: entry.models || [] }));
  for (const node of await getProviderNodes() as Model[]) {
    if (node.prefix === prefix || node.id === prefix) candidates.push({ id: node.id, prefix, builtins: [] });
  }
  if (candidates.length !== 1) return false;
  const { rows } = await inventory(candidates[0], allowMalformedSync);
  if (rows.has(localId)) return true;
  const scoped = { providerId: candidates[0].id, nodeId: null, prefix, models: specialtyRows(candidates[0], [...rows.values()]) };
  expandAdminInventories([scoped], {}, new Map());
  return scoped.models.some(row => row.id === localId);
}
function specialtyRows(p: NonNullable<Awaited<ReturnType<typeof provider>>>, models: Model[] = []) {
  const scoped: ScopedInventory = { providerId: p.id, nodeId: Object.hasOwn(managementRegistry(), p.id) && managementRegistry()[p.id]?.id === p.id ? null : p.id, prefix: p.prefix, models };
  expandEmbeddingInventory([scoped]);
  expandSpecialtyInventory([scoped]);
  return scoped.models;
}
async function hasProviderPrefix(id: string) {
  if (!id.includes("/")) return false;
  const prefix = id.split("/")[0];
  if (Object.values(REGISTRY).some(e => e.id === prefix || e.alias === prefix)) return true;
  const nodes = await getProviderNodes() as Model[];
  return nodes.some(node => node.id === prefix || node.prefix === prefix);
}
const audit = (action: string, providerId: string, modelId: string) => logAuditEvent({ action, actor: "admin", target: `${providerId}/${modelId}`, resourceType: "admin_api", status: "success" });

export function createProviderModelsApi() {
  const api = new Hono();
  api.onError((error, c) => {
    if (error instanceof ProviderModelConflict) return c.json({ error: error.message }, error.status);
    console.error("Provider model operation failed", error);
    return c.json({ error: "Provider model operation failed" }, 500);
  });
  api.get("/admin/provider-catalog", async c => {
    const nodes = await getProviderNodes() as Model[];
    const providers = Object.entries(managementRegistry()).filter(([id, entry]) => entry.id === id)
      .map(([id, entry]) => ({ id, prefix: id, builtins: entry.models || [], nodeId: null as string | null }));
    for (const node of nodes) providers.push({ id: node.id, prefix: node.prefix || node.id, builtins: [], nodeId: node.id });
    const inventories = await Promise.all(providers.map(async p => {
      const loaded = await inventory(p, true);
      return { providerId: p.id, nodeId: p.nodeId, prefix: p.prefix, models: [...loaded.rows.values()], malformedSync: loaded.malformedSync };
    }));
    const prefixes = new Map<string, string[]>();
    for (const p of providers) for (const prefix of new Set([p.id, p.prefix, REGISTRY[p.id]?.alias].filter((v): v is string => !!v))) {
      prefixes.set(prefix, [...(prefixes.get(prefix) || []), p.id]);
    }
    expandEmbeddingInventory(inventories);
    expandSpecialtyInventory(inventories);
    expandAdminInventories(inventories, await getModelAliases(), prefixes);
    c.header("Cache-Control", "no-store");
    return c.json({ coverage: { complete: false, malformedSyncedProviders: inventories.filter(i => i.malformedSync).map(i => i.providerId), sources: ["provider-inventory", "embedding-registry", "image-registry", "rerank-registry", "audio-registry", "moderation-registry", "video-registry", "music-registry", "alias-backed-targets", "generated-effort"], description: "Registry, stored sync and custom inventories, provider-scoped specialty registry entries, unambiguous alias targets and selected effort variants; not the served or eligible /v1/models catalog. Other sources and variants are omitted." }, data: buildScopedInventoryRows(inventories) });
  });
  api.get("/providers/:providerId/models", async c => {
    const p = await provider(c.req.param("providerId"));
    if (!p) return c.json({ error: "Provider not found" }, 404);
    c.header("Cache-Control", "no-store");
    const connectionId = c.req.query("connectionId");
    if (connectionId !== undefined) {
      if (!/^[A-Za-z0-9-]{1,100}$/.test(connectionId)) return c.json({ error: "Invalid account" }, 400);
      const scoped = await accountInventory(p, connectionId);
      if (!scoped) return c.json({ error: "Account unavailable for this provider" }, 400);
      return c.json({ providerId: p.id, prefix: p.prefix, connectionId, catalogStatus: scoped.catalogStatus, models: scoped.models });
    }
    const { rows } = await inventory(p);
    return c.json({ providerId: p.id, prefix: p.prefix, models: specialtyRows(p, [...rows.values()]) });
  });
  api.post("/providers/:providerId/models", async c => {
    const p = await provider(c.req.param("providerId"));
    if (!p) return c.json({ error: "Provider not found" }, 404);
    const result = createSchema.safeParse(await c.req.json().catch(() => null));
    if (!result.success || await hasProviderPrefix(result.data.id)) return c.json({ error: "Invalid model" }, 400);
    const m = result.data;
    const model = await addCustomModel(p.id, m.id, m.name, "manual", m.apiFormat, m.supportedEndpoints && normalizeModelSupportedEndpoints(m.supportedEndpoints), m.targetFormat, { inputTokenLimit: m.inputTokenLimit, outputTokenLimit: m.outputTokenLimit }, m.supportsVision, undefined, { builtinIds: p.builtins.map(m => m.id), createOnlyProtectedIds: specialtyRows(p).map(row => row.id) });
    if (!model) return c.json({ error: "Model already exists" }, 409);
    audit("providerModel.create", p.id, m.id);
    return c.json({ ...model, origin: "manual" }, 201);
  });
  api.patch("/providers/:providerId/models/:modelId", async c => {
    const p = await provider(c.req.param("providerId"));
    if (!p) return c.json({ error: "Provider not found" }, 404);
    const id = c.req.param("modelId");
    const result = patchSchema.safeParse(await c.req.json().catch(() => null));
    if (!idSchema.safeParse(id).success || !result.success) return c.json({ error: "Invalid model" }, 400);
    const { name, ...rest } = result.data;
    const model = await updateCustomModel(p.id, id, { ...rest, ...(name === undefined ? {} : { modelName: name }), ...(rest.supportedEndpoints ? { supportedEndpoints: normalizeModelSupportedEndpoints(rest.supportedEndpoints) } : {}) }, { builtinIds: p.builtins.map(m => m.id) });
    audit("providerModel.update", p.id, id);
    return c.json({ ...model, origin: "manual" });
  });
  api.delete("/providers/:providerId/models/:modelId", async c => {
    const p = await provider(c.req.param("providerId"));
    if (!p) return c.json({ error: "Provider not found" }, 404);
    const id = c.req.param("modelId");
    if (!idSchema.safeParse(id).success) return c.json({ error: "Invalid model" }, 400);
    await removeCustomModel(p.id, id, { builtinIds: p.builtins.map(m => m.id) });
    audit("providerModel.delete", p.id, id);
    return c.json({ success: true });
  });
  return api;
}

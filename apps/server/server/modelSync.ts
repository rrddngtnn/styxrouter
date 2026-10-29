// Mounted behind requireAuth. Catalog membership is account-specific, not a static registry override.
import { Hono } from "hono";
import { isCodexDiscoveryModelExcluded } from "../src/shared/services/codexDiscoveryPolicy.ts";
import { getProviderConnectionById } from "../src/lib/db/providers.ts";
import { invalidateDbCache } from "../src/lib/db/readCache.ts";
import { getDbInstance } from "../src/lib/db/core.ts";
import { normalizeSyncedAvailableModels } from "../src/lib/db/models/synced.ts";
import { finishSyncedAvailableModelsWrite } from "../src/lib/db/models/syncedAvailableModelPersistence.ts";
import { isKnownCodexCatalog, reconcileCodexContextWindowsInTransaction } from "../src/lib/contextWindowResolver.ts";
import { randomUUID } from "node:crypto";
import { isConnectionUnavailableToAuxiliaryActivity } from "../src/lib/exclusiveLeaseIsolation.ts";
import { getCodexBackendIdentityHeaders, getCodexClientVersion } from "../open-sse/config/codexClient.ts";
import { getAccessToken } from "../open-sse/services/tokenRefresh.ts";
import { updateProviderCredentials } from "../src/sse/services/tokenRefresh.ts";

// Shared by every mounted API instance in this process. A durable fencing token
// additionally prevents an older request in another process from publishing.
const inFlight = new Set<string>();

export function createModelSyncApi(deps: { fetch?: typeof fetch } = {}) {
  const api = new Hono();
  api.post("/providers/:id/sync-models", async (c) => {
    const id = c.req.param("id");
    if (inFlight.has(id)) return c.json({ error: "Connection is busy" }, 409);
    inFlight.add(id);
    let fence: string | undefined;
    try {
      const db = getDbInstance();
      fence = randomUUID();
      db.prepare("INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES ('codexSyncFence', ?, ?)").run(id, fence);
      if (await isConnectionUnavailableToAuxiliaryActivity(id)) {
        return c.json({ error: "Connection is busy" }, 409);
      }
      const conn = await getProviderConnectionById(id) as any;
      if (!conn) return c.json({ error: "Connection not found" }, 404);
      if (conn.provider !== "codex") return c.json({ error: "Model sync is not supported for this provider" }, 422);
      if (conn.isActive === false) return c.json({ error: "Connection is inactive" }, 409);
      const expires = conn.tokenExpiresAt ?? conn.expiresAt;
      const due = expires && Date.now() >= Date.parse(expires) - 60000;
      const refreshed = due ? await getAccessToken("codex", {
        accessToken: conn.accessToken, refreshToken: conn.refreshToken,
        expiresAt: conn.tokenExpiresAt ?? conn.expiresAt,
        connectionId: id, providerSpecificData: conn.providerSpecificData,
      }, { warn: () => {}, error: () => {} }, null,
      async (credentials) => {
        if (await updateProviderCredentials(id, credentials as Record<string, unknown>) === false) {
          throw new Error("Failed to persist refreshed credentials");
        }
      }) : conn;
      const token = refreshed?.accessToken;
      if (!token) return c.json({ error: "Connection requires authentication" }, 409);
      const headers: Record<string, string> = {
        ...getCodexBackendIdentityHeaders(), Authorization: `Bearer ${token}`, Accept: "application/json",
      };
      const workspace = conn.providerSpecificData?.workspaceId;
      if (typeof workspace === "string" && workspace) headers["chatgpt-account-id"] = workspace;
      const response = await (deps.fetch ?? globalThis.fetch)(
        `https://chatgpt.com/backend-api/codex/models?client_version=${encodeURIComponent(getCodexClientVersion())}`,
        { headers, redirect: "error", signal: AbortSignal.timeout(20000) },
      );
      if (!response.ok) return c.json({ error: "Upstream model catalog request failed", upstreamStatus: response.status }, 502);
      const payload = await response.json() as any;
      // Codex uses models[].slug, NOT OpenAI's data[].id. A bad/empty response must not erase last-good state.
      if (!Array.isArray(payload?.models) || payload.models.length === 0 ||
          payload.models.some((m: any) => typeof m?.slug !== "string" || !m.slug.trim())) {
        return c.json({ error: "Upstream model catalog is empty or malformed" }, 502);
      }
      let published = false;
      let count = 0;
      let usable = true;
      db.immediate(() => {
        const currentFence = db.prepare("SELECT value FROM key_value WHERE namespace = 'codexSyncFence' AND key = ?").get(id) as { value: string } | undefined;
        const active = db.prepare("SELECT is_active FROM provider_connections WHERE id = ? AND provider = 'codex'").get(id) as { is_active: number } | undefined;
        if (currentFence?.value !== fence || active?.is_active !== 1) return;
        const key = `codex:${id}`;
        const row = db.prepare("SELECT value FROM key_value WHERE namespace = 'syncedAvailableModels' AND key = ?").get(key) as { value: string } | undefined;
        let prior: ReturnType<typeof normalizeSyncedAvailableModels> = [];
        try {
          const parsed = JSON.parse(row?.value ?? "null");
          if (isKnownCodexCatalog(parsed)) prior = normalizeSyncedAvailableModels(parsed, "codex");
        } catch { /* unknown */ }
        const previous = new Map(prior.map(m => [m.id, m]));
        const models = payload.models.map((m: any) => ({
          id: m.slug, name: typeof m.display_name === "string" ? m.display_name : m.slug,
          supportedThinkingEfforts: Array.isArray(m.supported_reasoning_levels)
            ? m.supported_reasoning_levels.map((level: any) => level?.effort).filter((effort: unknown) => typeof effort === "string") : [],
          ...(typeof m.default_reasoning_level === "string" ? { defaultThinkingEffort: m.default_reasoning_level } : {}),
          ...(() => {
            const value = Number.isSafeInteger(m.context_window) && m.context_window > 0
              ? m.context_window : previous.get(m.slug)?.inputTokenLimit;
            return Number.isSafeInteger(value) && value! > 0 ? { inputTokenLimit: value } : {};
          })(),
        })).filter((model: any) => !isCodexDiscoveryModelExcluded(model));
        if (!models.length) { usable = false; return; }
        const normalized = normalizeSyncedAvailableModels(models, "codex");
        count = normalized.length;
        const ids = new Set(normalized.map(m => m.id));
        db.prepare("INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES ('syncedAvailableModels', ?, ?)").run(key, JSON.stringify(normalized));
        reconcileCodexContextWindowsInTransaction(prior.filter(m => !ids.has(m.id)).map(m => m.id));
        db.prepare("UPDATE provider_connections SET provider_specific_data = json_set(CASE WHEN json_valid(provider_specific_data) AND json_type(provider_specific_data) = 'object' THEN provider_specific_data ELSE '{}' END, '$.modelCatalogSyncedAt', ?) WHERE id = ?").run(new Date().toISOString(), id);
        published = true;
      });
      if (!usable) return c.json({ error: "Upstream model catalog has no usable models" }, 502);
      if (!published) return c.json({ error: "Synchronization superseded or inactive" }, 409);
      finishSyncedAvailableModelsWrite();
      invalidateDbCache("connections");
      return c.json({ success: true, syncedModels: count });
    } catch {
      // Never expose credentials or upstream bodies in admin errors.
      return c.json({ error: "Model catalog synchronization failed" }, 502);
    } finally {
      try {
        if (fence) getDbInstance().prepare("DELETE FROM key_value WHERE namespace = 'codexSyncFence' AND key = ? AND value = ?").run(id, fence);
      } finally { inFlight.delete(id); }
    }
  });
  return api;
}

// Mounted behind requireAuth. Catalog membership is account-specific, not a static registry override.
import { Hono } from "hono";
import { isCodexDiscoveryModelExcluded } from "../src/shared/services/codexDiscoveryPolicy.ts";
import { getProviderConnectionById, updateProviderConnection } from "../src/lib/db/providers.ts";
import { replaceSyncedAvailableModelsForConnection } from "../src/lib/db/models.ts";
import { isConnectionUnavailableToAuxiliaryActivity } from "../src/lib/exclusiveLeaseIsolation.ts";
import { getCodexBackendIdentityHeaders, getCodexClientVersion } from "../open-sse/config/codexClient.ts";
import { getAccessToken } from "../open-sse/services/tokenRefresh.ts";
import { updateProviderCredentials } from "../src/sse/services/tokenRefresh.ts";

export function createModelSyncApi(deps: { fetch?: typeof fetch } = {}) {
  const api = new Hono();
  const inFlight = new Set<string>();
  api.post("/providers/:id/sync-models", async (c) => {
    const id = c.req.param("id");
    if (inFlight.has(id) || await isConnectionUnavailableToAuxiliaryActivity(id)) {
      return c.json({ error: "Connection is busy" }, 409);
    }
    inFlight.add(id);
    try {
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
      const models = payload.models.map((m: any) => ({
        id: m.slug, name: typeof m.display_name === "string" ? m.display_name : m.slug,
        supportedThinkingEfforts: Array.isArray(m.supported_reasoning_levels)
          ? m.supported_reasoning_levels.map((level: any) => level?.effort).filter((effort: unknown) => typeof effort === "string") : [],
        ...(typeof m.default_reasoning_level === "string" ? { defaultThinkingEffort: m.default_reasoning_level } : {}),
        ...(typeof m.context_window === "number" ? { inputTokenLimit: m.context_window } : {}),
      })).filter((model: any) => !isCodexDiscoveryModelExcluded(model));
      if (models.length === 0) return c.json({ error: "Upstream model catalog has no usable models" }, 502);
      await replaceSyncedAvailableModelsForConnection("codex", id, models);
      const current = await getProviderConnectionById(id) as any;
      await updateProviderConnection(id, { providerSpecificData: {
        ...current?.providerSpecificData, modelCatalogSyncedAt: new Date().toISOString(),
      } });
      return c.json({ success: true, syncedModels: new Set(models.map((m: any) => m.id)).size });
    } catch {
      // Never expose credentials or upstream bodies in admin errors.
      return c.json({ error: "Model catalog synchronization failed" }, 502);
    } finally {
      inFlight.delete(id);
    }
  });
  return api;
}

import { expect, spyOn, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "styx-sync-"));
process.env.STYX_TEST_MODE = "1";
const { createProviderConnection } = await import("../src/lib/db/providers.ts");
const { getSyncedAvailableModelsForConnection } = await import("../src/lib/db/models.ts");
const { createModelSyncApi } = await import("../server/modelSync.ts");

test("sync aborts when refreshed credentials cannot be persisted", async () => {
  const conn = await createProviderConnection({ provider: "codex", authType: "oauth", accessToken: "test-only-expired", expiresAt: "2000-01-01T00:00:00Z", name: "Persistence failure" } as any);
  const { replaceSyncedAvailableModelsForConnection } = await import("../src/lib/db/models.ts");
  await replaceSyncedAvailableModelsForConnection("codex", conn.id, [{ id: "last-good", name: "Last good" }]);
  const refresh = await import("../open-sse/services/tokenRefresh.ts");
  const persistence = await import("../src/sse/services/tokenRefresh.ts");
  const persist = spyOn(persistence, "updateProviderCredentials").mockResolvedValue(false);
  const getToken = spyOn(refresh, "getAccessToken").mockImplementation(async (_provider, _credentials, _log, _proxy, onPersist) => {
    const credentials = { accessToken: "test-only-rotated" };
    await onPersist!(credentials);
    return credentials;
  });
  let fetched = false;
  const api = createModelSyncApi({ fetch: (async () => {
    fetched = true;
    return Response.json({ models: [{ slug: "should-not-persist" }] });
  }) as typeof fetch });
  try {
    const response = await api.request(`/providers/${conn.id}/sync-models`, { method: "POST" });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Model catalog synchronization failed" });
    expect(persist).toHaveBeenCalledTimes(1);
    expect(fetched).toBe(false);
    expect((await getSyncedAvailableModelsForConnection("codex", conn.id)).map((model) => model.id)).toEqual(["last-good"]);
    const { getProviderConnectionById } = await import("../src/lib/db/providers.ts");
    expect((await getProviderConnectionById(conn.id))?.providerSpecificData?.modelCatalogSyncedAt).toBeUndefined();
  } finally {
    getToken.mockRestore();
    persist.mockRestore();
  }
});

test("internal scheduler authentication is scoped to POST sync-models only", async () => {
  const { Hono } = await import("hono");
  const { requireAuth } = await import("../server/auth.ts");
  const { buildModelSyncInternalHeaders } = await import("../src/shared/services/modelSyncScheduler.ts");
  const app = new Hono();
  app.use("*", requireAuth);
  app.all("*", (c) => c.json({ ok: true }));
  const headers = buildModelSyncInternalHeaders();
  expect((await app.request("/api/providers/a/sync-models", { method: "POST", headers })).status).toBe(200);
  expect((await app.request("/api/providers/a/sync-models", { headers })).status).toBe(401);
  expect((await app.request("/api/keys", { method: "POST", headers })).status).toBe(401);
  expect((await app.request("/api/providers/a/sync-models", { method: "POST" })).status).toBe(401);
});

test("sync rejects malformed payloads without replacing last-good inventory", async () => {
  const conn = await createProviderConnection({ provider: "codex", authType: "oauth", accessToken: "test-only-token", name: "Malformed" } as any);
  const { replaceSyncedAvailableModelsForConnection } = await import("../src/lib/db/models.ts");
  await replaceSyncedAvailableModelsForConnection("codex", conn.id, [{ id: "gpt-6.1-terra", name: "Terra" }]);
  for (const payload of [{ models: [] }, { data: [{ id: "wrong-schema" }] }, { models: [{ display_name: "No slug" }] }]) {
    const api = createModelSyncApi({ fetch: (async () => Response.json(payload)) as typeof fetch });
    expect((await api.request(`/providers/${conn.id}/sync-models`, { method: "POST" })).status).toBe(502);
    expect((await getSyncedAvailableModelsForConnection("codex", conn.id))[0].id).toBe("gpt-6.1-terra");
  }
});

test("sync applies the existing Codex discovery retirement policy", async () => {
  const conn = await createProviderConnection({ provider: "codex", authType: "oauth", accessToken: "test-only-token", name: "Retired" } as any);
  const api = createModelSyncApi({ fetch: (async () => Response.json({ models: [
    { slug: "gpt-5.4", display_name: "Retired" }, { slug: "gpt-6.1-terra", display_name: "Terra" },
  ] })) as typeof fetch });
  const response = await api.request(`/providers/${conn.id}/sync-models`, { method: "POST" });
  expect(response.status).toBe(200);
  expect((await getSyncedAvailableModelsForConnection("codex", conn.id)).map((m) => m.id)).toEqual(["gpt-6.1-terra"]);
});

test("sync-models persists Codex slugs per account and keeps last good catalog on upstream failure", async () => {
  const conn = await createProviderConnection({ provider: "codex", authType: "oauth", accessToken: "test-only-token", name: "Test" } as any);
  let fail = false;
  const api = createModelSyncApi({ fetch: (async (url, init) => {
    expect(String(url)).toContain("/backend-api/codex/models?client_version=");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-only-token");
    return fail ? new Response("private upstream body", { status: 503 }) : Response.json({ models: [
      { slug: "gpt-6.1-terra", display_name: "Terra", supported_reasoning_levels: [{ effort: "high" }], context_window: 200000 },
    ] });
  }) as typeof fetch });
  const request = () => api.request(`/providers/${conn.id}/sync-models`, { method: "POST" });
  const response = await request();
  expect(response.status).toBe(200);
  expect((await response.json()).syncedModels).toBe(1);
  expect((await getSyncedAvailableModelsForConnection("codex", conn.id))[0]).toMatchObject({ id: "gpt-6.1-terra", supportedThinkingEfforts: ["high"] });
  fail = true;
  const failed = await request();
  expect(failed.status).toBe(502);
  expect(await failed.text()).not.toContain("private upstream body");
  expect((await getSyncedAvailableModelsForConnection("codex", conn.id))[0].id).toBe("gpt-6.1-terra");
});

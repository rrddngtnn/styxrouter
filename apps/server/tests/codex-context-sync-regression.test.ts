import { expect, test } from "bun:test";

const { createProviderConnection, updateProviderConnection } = await import("../src/lib/db/providers.ts");
const { getSyncedAvailableModelsForConnection, replaceSyncedAvailableModelsForConnection } = await import("../src/lib/db/models.ts");
const { getModelContextOverrideRecord, setModelContextOverride, removeModelContextOverride } = await import("../src/lib/db/modelContextOverrides.ts");
const { createModelSyncApi } = await import("../server/modelSync.ts");
const { getUnifiedModelsResponse } = await import("../src/app/api/v1/models/catalog.ts");
const { runContextWindowReconcile } = await import("../src/lib/contextWindowResolver.ts");
const { getResolvedModelCapabilities } = await import("../src/lib/modelCapabilities.ts");
const model = "gpt-6.1-terra";
const makeConnection = (name: string) => createProviderConnection({ provider: "codex", authType: "oauth", accessToken: "fixture", isActive: true, name } as any);
const sync = (id: string, fetch: typeof globalThis.fetch) => createModelSyncApi({ fetch }).request(`/providers/${id}/sync-models`, { method: "POST" });
const upstream = (window: unknown) => (async () => Response.json({ models: [{ slug: model, context_window: window, max_context_window: 872000 }] })) as typeof fetch;

test("sync replaces existing stale auto value using upstream metadata and serves base and aliases", async () => {
  const conn = await makeConnection("sync");
  await replaceSyncedAvailableModelsForConnection("codex", conn.id, [{ id: model, name: model, inputTokenLimit: 200000 }]);
  setModelContextOverride("codex", model, 200000, "auto:discovery");
  expect((await sync(conn.id, upstream(500000))).status).toBe(200);
  expect((await getSyncedAvailableModelsForConnection("codex", conn.id))[0].inputTokenLimit).toBe(500000);
  expect(getModelContextOverrideRecord("codex", model)?.realContext ?? 500000).toBe(500000);
  const response = await getUnifiedModelsResponse(new Request("http://localhost/v1/models"));
  const body: any = await response.json();
  for (const suffix of ["", "-none", "-low", "-medium", "-high", "-xhigh", "-max", "-ultra"]) {
    const entry = body.data.find((r: any) => r.id === `codex/${model}${suffix}`);
    expect(entry?.context_length).toBe(1000000);
    expect(entry?.max_input_tokens).toBeUndefined();
  }
});

test("account windows use the minimum among active known accounts; inactive accounts do not win", async () => {
  const a = await makeConnection("a");
  const b = await makeConnection("b");
  expect((await sync(a.id, upstream(400000))).status).toBe(200);
  expect((await sync(b.id, upstream(600000))).status).toBe(200);
  await runContextWindowReconcile();
  expect(getModelContextOverrideRecord("codex", model)?.realContext).toBe(400000);
  await updateProviderConnection(a.id, { isActive: false });
  await runContextWindowReconcile();
  expect(getResolvedModelCapabilities({ provider: "codex", model }).contextWindow).toBe(500000); // first test's active account
  await updateProviderConnection(b.id, { isActive: false });
});

test("sync persists upstream values other than the fallback, without using max_context_window", async () => {
  const conn = await makeConnection("different-upstream");
  expect((await sync(conn.id, upstream(320000))).status).toBe(200);
  expect((await getSyncedAvailableModelsForConnection("codex", conn.id))[0].inputTokenLimit).toBe(320000);
  expect(getModelContextOverrideRecord("codex", model)?.realContext).toBe(320000);
  await updateProviderConnection(conn.id, { isActive: false });
  await runContextWindowReconcile("codex");
});

test("manual overrides survive syncing and auto upserts", async () => {
  const conn = await makeConnection("manual");
  setModelContextOverride("codex", model, 333333, "manual");
  expect((await sync(conn.id, upstream(700000))).status).toBe(200);
  setModelContextOverride("codex", model, 111111, "auto:discovery");
  expect(getModelContextOverrideRecord("codex", model)?.realContext).toBe(333333);
  const { removeAutoModelContextOverride } = await import("../src/lib/db/modelContextOverrides.ts");
  expect(removeAutoModelContextOverride("codex", model)).toBe(false);
  expect(getModelContextOverrideRecord("codex", model)?.source).toBe("manual");
  removeModelContextOverride("codex", model);
});

test("malformed context and failed catalogs retain the last-good account window", async () => {
  const conn = await makeConnection("last-good");
  expect((await sync(conn.id, upstream(444444))).status).toBe(200);
  for (const value of [null, "500000", 0, -1, 1.5]) {
    expect((await sync(conn.id, upstream(value))).status).toBe(200);
    expect((await getSyncedAvailableModelsForConnection("codex", conn.id))[0].inputTokenLimit).toBe(444444);
  }
  for (const fetcher of [
    (async () => new Response("bad json")) as typeof fetch,
    (async () => Response.json({ models: [] })) as typeof fetch,
    (async () => new Response("failed", { status: 500 })) as typeof fetch,
    (async () => { throw new Error("network"); }) as typeof fetch,
  ]) {
    expect((await sync(conn.id, fetcher)).status).toBe(502);
    expect((await getSyncedAvailableModelsForConnection("codex", conn.id))[0].inputTokenLimit).toBe(444444);
  }
});

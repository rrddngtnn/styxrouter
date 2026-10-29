import { expect, test } from "bun:test";
import { createProviderConnection, updateProviderConnection, deleteProviderConnection, deleteProviderConnections, deleteProviderConnectionsByProvider } from "../src/lib/db/providers";
import { createModelSyncApi } from "../server/modelSync";
import { getModelContextOverrideRecord } from "../src/lib/db/modelContextOverrides";

const model = "aggregate-race-model";
async function make(name: string, window: number) {
  const c = await createProviderConnection({ provider: "codex", authType: "oauth", accessToken: "fixture", isActive: true, name } as any);
  const api = createModelSyncApi({ fetch: (async () => Response.json({ models: [{ slug: model, context_window: window }] })) as typeof fetch });
  expect((await api.request(`/providers/${c.id}/sync-models`, { method: "POST" })).status).toBe(200);
  return c;
}
const value = () => getModelContextOverrideRecord("codex", model)?.realContext;

test("an unrelated update cannot undo a concurrent activation transition", async () => {
  const a = await make("race-low", 200000), b = await make("race-high", 600000);
  await Promise.all([updateProviderConnection(a.id, { isActive: false }), updateProviderConnection(a.id, { name: "renamed" })]);
  const { getProviderConnectionById } = await import("../src/lib/db/providers");
  expect((await getProviderConnectionById(a.id))?.isActive).toBe(false);
  expect(value()).toBe(600000);
  await deleteProviderConnections([a.id, b.id]);
});

for (const kind of ["single", "bulk"] as const) {
  test(`${kind} deletion reconciles remaining active windows`, async () => {
    const low = await make(`delete-${kind}-low`, 200000), high = await make(`delete-${kind}-high`, 600000);
    if (kind === "single") await deleteProviderConnection(low.id);
    else await deleteProviderConnections([low.id]);
    expect(value()).toBe(600000);
    await deleteProviderConnection(high.id);
  });
}

test("provider deletion preserves last-good value when no active accounts remain", async () => {
  await make("provider-delete-low", 200000);
  await make("provider-delete-high", 600000);
  expect(await deleteProviderConnectionsByProvider("codex")).toBe(2);
  expect(value()).toBe(200000);
});

test("deleting an unknown catalog releases a deferred removal", async () => {
  const known = await make("pending-known", 410000);
  const unknown = await createProviderConnection({ provider: "codex", authType: "oauth", accessToken: "fixture", isActive: true, name: "pending-unknown" } as any);
  const api = createModelSyncApi({ fetch: (async () => Response.json({ models: [{ slug: "replacement", context_window: 500000 }] })) as typeof fetch });
  expect((await api.request(`/providers/${known.id}/sync-models`, { method: "POST" })).status).toBe(200);
  expect(value()).toBe(410000);
  await deleteProviderConnection(unknown.id);
  expect(value()).toBeUndefined();
  await deleteProviderConnection(known.id);
});

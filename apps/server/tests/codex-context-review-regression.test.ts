import { expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { createProviderConnection, updateProviderConnection } = await import("../src/lib/db/providers.ts");
const { createModelSyncApi } = await import("../server/modelSync.ts");
const { getModelContextOverrideRecord, setModelContextOverride, removeModelContextOverride } = await import("../src/lib/db/modelContextOverrides.ts");
const { getResolvedModelCapabilities } = await import("../src/lib/modelCapabilities.ts");
const { getDbInstance } = await import("../src/lib/db/core.ts");
const { runContextWindowReconcile } = await import("../src/lib/contextWindowResolver.ts");
const model = "review-context-model";
const make = (name: string) => createProviderConnection({ provider: "codex", authType: "oauth", accessToken: "fixture", isActive: true, name } as any);
const response = (id: string, window?: number) => Response.json({ models: [{ slug: id, context_window: window }] });
const sync = (id: string, fetcher: typeof fetch) => createModelSyncApi({ fetch: fetcher }).request(`/providers/${id}/sync-models`, { method: "POST" });
const fetchModel = (id: string, window?: number) => (async () => response(id, window)) as typeof fetch;
const override = () => getModelContextOverrideRecord("codex", model);

test("successful removal deletes only known removed automatic overrides", async () => {
  const conn = await make("removal");
  expect((await sync(conn.id, fetchModel(model, 320000))).status).toBe(200);
  expect(override()?.realContext).toBe(320000);
  expect((await sync(conn.id, fetchModel("another-model", 600000))).status).toBe(200);
  expect(override()).toBeNull();
  await updateProviderConnection(conn.id, { isActive: false });
});

test("activation and deactivation recompute active windows immediately", async () => {
  const a = await make("low"), b = await make("high");
  await sync(a.id, fetchModel(model, 200000)); await sync(b.id, fetchModel(model, 600000));
  await updateProviderConnection(a.id, { isActive: false });
  expect(getResolvedModelCapabilities({ provider: "codex", model }).contextWindow).toBe(600000);
  await updateProviderConnection(a.id, { isActive: true });
  expect(getResolvedModelCapabilities({ provider: "codex", model }).contextWindow).toBe(200000);
  await updateProviderConnection(a.id, { isActive: false }); await updateProviderConnection(b.id, { isActive: false });
});

test("an in-flight sync cannot publish after deactivation", async () => {
  const c = await make("deactivate-during-sync"); let release!: () => void; let entered!: () => void;
  const gate = new Promise<void>(r => release = r), started = new Promise<void>(r => entered = r);
  const request = sync(c.id, (async () => { entered(); await gate; return response("deactivation-model", 310000); }) as typeof fetch);
  await started; await updateProviderConnection(c.id, { isActive: false }); release();
  expect((await request).status).toBe(409);
  expect(getModelContextOverrideRecord("codex", "deactivation-model")).toBeNull();
});

test("an in-flight sync is fenced even if the account is reactivated before it returns", async () => {
  const c = await make("toggle-during-sync"); let release!: () => void; let entered!: () => void;
  const gate = new Promise<void>(r => release = r), started = new Promise<void>(r => entered = r);
  const request = sync(c.id, (async () => { entered(); await gate; return response("toggle-model", 310000); }) as typeof fetch);
  await started; await updateProviderConnection(c.id, { isActive: false }); await updateProviderConnection(c.id, { isActive: true }); release();
  expect((await request).status).toBe(409);
  await updateProviderConnection(c.id, { isActive: false });
});

test("independent sync APIs reject overlapping requests for the same account", async () => {
  const c = await make("race"); let release!: () => void; let entered!: () => void;
  const gate = new Promise<void>(r => release = r), started = new Promise<void>(r => entered = r);
  const slow = sync(c.id, (async () => { entered(); await gate; return response(model, 310000); }) as typeof fetch);
  await started;
  try { expect((await sync(c.id, fetchModel(model, 620000))).status).toBe(409); }
  finally { release(); }
  expect((await slow).status).toBe(200);
  await updateProviderConnection(c.id, { isActive: false });
});

test("unknown catalogs, missing windows, failed syncs, and manual overrides are preserved", async () => {
  const a = await make("known"), b = await make("unknown");
  await sync(a.id, fetchModel(model, 410000));
  await sync(a.id, (async () => Response.json({ models: [] })) as typeof fetch);
  expect(override()?.realContext).toBe(410000);
  await sync(a.id, fetchModel("different", 100000));
  expect(override()?.realContext).toBe(410000); // another active catalog is unknown
  getDbInstance().prepare("INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES ('syncedAvailableModels', ?, ?)").run(`codex:${b.id}`, "not-json");
  await runContextWindowReconcile("codex");
  expect(override()?.realContext).toBe(410000);
  await sync(b.id, fetchModel("different", 100000));
  expect(override()).toBeNull(); // pending removal is retried when the unknown catalog becomes known
  setModelContextOverride("codex", model, 333333, "manual");
  await sync(b.id, fetchModel(model));
  await sync(b.id, fetchModel("different", 100000));
  await runContextWindowReconcile("codex");
  expect(override()?.realContext).toBe(333333);
  removeModelContextOverride("codex", model);
  await updateProviderConnection(a.id, { isActive: false }); await updateProviderConnection(b.id, { isActive: false });
});

test("malformed prior catalogs cannot authorize auto-override deletion", async () => {
  const conn = await make("malformed-prior");
  setModelContextOverride("codex", model, 390000, "auto:discovery");
  getDbInstance().prepare("INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES ('syncedAvailableModels', ?, ?)").run(`codex:${conn.id}`, JSON.stringify([{ id: model }, { bad: true }]));
  expect((await sync(conn.id, fetchModel("replacement", 100000))).status).toBe(200);
  expect(override()?.realContext).toBe(390000);
  removeModelContextOverride("codex", model);
  await updateProviderConnection(conn.id, { isActive: false });
});

test("an active account with a known model but unknown window prevents deletion", async () => {
  const a = await make("has-window"), b = await make("no-window");
  await sync(a.id, fetchModel(model, 420000)); await sync(b.id, fetchModel(model));
  await sync(a.id, fetchModel("replacement", 100000));
  expect(override()?.realContext).toBe(420000);
  await updateProviderConnection(a.id, { isActive: false }); await updateProviderConnection(b.id, { isActive: false });
  removeModelContextOverride("codex", model);
});

test("a separate process cannot publish a superseded catalog", async () => {
  const conn = await make("cross-process");
  const started = join(process.env.TMPDIR!, `started-${conn.id}`);
  const release = join(process.env.TMPDIR!, `release-${conn.id}`);
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "helpers/codex-sync-fence-worker.ts"), conn.id, started, release], {
    env: process.env, cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe",
  });
  try {
    const deadline = Date.now() + 15000;
    while (!existsSync(started) && Date.now() < deadline) await Bun.sleep(10);
    expect(existsSync(started)).toBe(true);
    expect((await sync(conn.id, fetchModel("fence-model", 620000))).status).toBe(200);
  } finally { writeFileSync(release, "go"); }
  const output = await new Response(child.stdout).text();
  const stderr = await new Response(child.stderr).text();
  expect(await child.exited).toBe(0);
  expect(output).toContain("WORKER_STATUS=409");
  expect(stderr).not.toContain("gate timeout");
  expect(getModelContextOverrideRecord("codex", "fence-model")?.realContext).toBe(620000);
  await updateProviderConnection(conn.id, { isActive: false });
}, 25000);

import { expect, spyOn, test } from "bun:test";
import * as providers from "../src/lib/db/providers";
import { getCachedRawProviderConnections, invalidateDbCache } from "../src/lib/db/readCache";
import { createProviderConnection, deleteProviderConnection } from "../src/lib/db/providers";
import { createModelSyncApi } from "../server/modelSync";
import { getUnifiedModelsResponse, __resetCatalogBuilderRunsForTest, __getCatalogBuilderRunsForTest } from "../src/app/api/v1/models/catalog";
import { resolveCachedCatalogResponse } from "../src/app/api/v1/models/catalogCache";

const model = "codex/gpt-6.1-terra";
async function connection() {
  const c = await createProviderConnection({ provider: "codex", authType: "oauth", accessToken: "fixture", isActive: true, name: "cross-process connection" } as any);
  const api = createModelSyncApi({ fetch: (async () => Response.json({ models: [{ slug: "connection-revision-probe", context_window: 123456 }] })) as typeof fetch });
  expect((await api.request(`/providers/${c.id}/sync-models`, { method: "POST" })).status).toBe(200);
  return c;
}
async function worker(id: string, operation: "activate" | "deactivate" | "delete") {
  const code = `import {updateProviderConnection,deleteProviderConnection} from './src/lib/db/providers.ts'; const id=${JSON.stringify(id)}; ${operation === "delete" ? "await deleteProviderConnection(id)" : `await updateProviderConnection(id,{isActive:${operation === "activate"}})`};`;
  const child = Bun.spawn([process.execPath, "-e", code], { cwd: process.cwd(), env: process.env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect({ status, stderr }).toEqual({ status: 0, stderr: "" });
}
async function visible() {
  const response = await getUnifiedModelsResponse(new Request("http://localhost/v1/models?configuredOnly=true"));
  expect(response.status).toBe(200);
  const body = await response.json() as { data: { id: string }[] };
  return body.data.some(item => item.id === model);
}

test("cross-process deactivation and activation invalidate primed connection and catalog caches", async () => {
  const c = await connection();
  __resetCatalogBuilderRunsForTest();
  expect(await visible()).toBe(true);
  expect(await visible()).toBe(true);
  expect(__getCatalogBuilderRunsForTest()).toBe(1);
  await worker(c.id, "deactivate");
  expect(await visible()).toBe(false);
  expect(await visible()).toBe(false);
  await worker(c.id, "activate");
  expect(await visible()).toBe(true);
  expect(await visible()).toBe(true);
  expect(__getCatalogBuilderRunsForTest()).toBe(3);
  await deleteProviderConnection(c.id);
});

test("cross-process deletion invalidates primed connection and catalog caches", async () => {
  const c = await connection();
  __resetCatalogBuilderRunsForTest();
  expect(await visible()).toBe(true);
  await worker(c.id, "delete");
  expect(await visible()).toBe(false);
  expect(await visible()).toBe(false);
  expect(__getCatalogBuilderRunsForTest()).toBe(2);
});

test("a stale raw connection read cannot repopulate the cache after another process deactivates", async () => {
  const c = await connection();
  invalidateDbCache("connections");
  const original = providers.getRawProviderConnections;
  let start!: () => void;
  let release!: () => void;
  const started = new Promise<void>(resolve => { start = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  const spy = spyOn(providers, "getRawProviderConnections").mockImplementation(async (...args) => {
    const rows = await original(...args);
    if (++calls === 1) { start(); await gate; }
    return rows;
  });
  try {
    const stale = getCachedRawProviderConnections({ provider: "codex" });
    await started;
    await worker(c.id, "deactivate");
    release();
    expect((await stale as any[]).find(row => row.id === c.id)?.isActive).toBe(true);
    expect((await getCachedRawProviderConnections({ provider: "codex" }) as any[]).find(row => row.id === c.id)?.isActive).toBe(false);
    expect(calls).toBe(2);
  } finally {
    release();
    spy.mockRestore();
    await deleteProviderConnection(c.id);
  }
});

test("a catalog build crossing a durable revision cannot populate the current cache", async () => {
  const c = await connection();
  __resetCatalogBuilderRunsForTest();
  let release!: () => void;
  let started!: () => void;
  const startedPromise = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  let builds = 0;
  const request = () => new Request("http://localhost/v1/models?prefix=revision-race");
  const build = async () => {
    const buildNumber = ++builds;
    if (buildNumber === 1) { started(); await gate; }
    return { body: String(buildNumber), headers: {}, status: 200, cacheTTL: 60000 };
  };
  const headers = { corsHeaders: {}, diagnosticHeaders: {} };
  const old = resolveCachedCatalogResponse(request(), headers, build);
  await startedPromise;
  await worker(c.id, "deactivate");
  expect(await (await resolveCachedCatalogResponse(request(), headers, build)).text()).toBe("2");
  release();
  expect(await (await old).text()).toBe("1");
  expect(await (await resolveCachedCatalogResponse(request(), headers, build)).text()).toBe("2");
  expect(builds).toBe(2);
  await deleteProviderConnection(c.id);
});

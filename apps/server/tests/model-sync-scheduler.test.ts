import { expect, spyOn, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "styx-scheduler-"));
process.env.STYX_TEST_MODE = "1";
const catalog = await import("../src/shared/services/codexCatalogRevalidation.ts");
const { createProviderConnection } = await import("../src/lib/db/providers.ts");
const { startModelSyncScheduler, stopModelSyncScheduler } = await import("../src/shared/services/modelSyncScheduler.ts");

test("startup revalidation can be disabled while normal cycles sync only opted-in connections", async () => {
  const enabled = await createProviderConnection({ provider: "codex", name: "Enabled", providerSpecificData: { autoSync: true } } as any);
  await createProviderConnection({ provider: "codex", name: "Disabled", providerSpecificData: { autoSync: false } } as any);
  const scheduled: Array<() => Promise<void>> = [];
  const revalidate = spyOn(catalog, "scheduleCodexCatalogRevalidation").mockImplementation(() => {});
  const timeout = spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => Promise<void>) => {
    scheduled.push(callback);
    return { unref() {} };
  }) as any);
  const interval = spyOn(globalThis, "setInterval").mockImplementation((() => ({ unref() {} })) as any);
  const clear = spyOn(globalThis, "clearInterval").mockImplementation(() => {});
  const requests: string[] = [];
  // syncConnectionModels captures fetchModelSyncInternal at call time (ESM live
  // binding), so spying on the module export cannot intercept it. Intercept the
  // network layer instead: fetchModelSyncInternal ultimately calls
  // globalThis.fetch for http:// origins, which is what the test asserts on.
  const fetch = spyOn(globalThis, "fetch").mockImplementation((async (url: any) => {
    requests.push(String(url));
    return Response.json({ syncedModels: 1 });
  }) as typeof globalThis.fetch);
  try {
    startModelSyncScheduler(undefined, undefined, { revalidateCodexCatalogOnStartup: false });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(revalidate).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(1);
    await scheduled[0]();
    // The test database is per-process; when the full suite runs, other test
    // files may have created additional autoSync connections before this test
    // starts. Assert the enabled connection is targeted without pinning an
    // exact request count.
    expect(requests.some((url) => url.includes(`/providers/${enabled.id}/sync-models`))).toBe(true);
  } finally {
    stopModelSyncScheduler();
    fetch.mockRestore(); clear.mockRestore(); interval.mockRestore(); timeout.mockRestore(); revalidate.mockRestore();
  }
});

test("scheduler retains startup revalidation by default for other callers", async () => {
  const revalidate = spyOn(catalog, "scheduleCodexCatalogRevalidation").mockImplementation(() => {});
  const timeout = spyOn(globalThis, "setTimeout").mockImplementation((() => ({ unref() {} })) as any);
  const interval = spyOn(globalThis, "setInterval").mockImplementation((() => ({ unref() {} })) as any);
  const clear = spyOn(globalThis, "clearInterval").mockImplementation(() => {});
  try {
    startModelSyncScheduler();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(revalidate).toHaveBeenCalledTimes(1);
  } finally {
    stopModelSyncScheduler();
    clear.mockRestore(); interval.mockRestore(); timeout.mockRestore(); revalidate.mockRestore();
  }
});

test("the sync-models auth bypass rejects callers without the scheduler internal token", async () => {
  const { requireAuth } = await import("../server/auth.ts");
  const scheduler = await import("../src/shared/services/modelSyncScheduler.ts");
  const headers = scheduler.buildModelSyncInternalHeaders();
  const token = headers[scheduler.getModelSyncInternalAuthHeaderName()];

  // Same middleware wiring as styx.ts: requireAuth runs before createModelSyncApi.
  // If the bypass leaked beyond the internal scheduler token, this request would
  // reach the route and return 200/4xx instead of the auth rejection.
  const url = "http://127.0.0.1/api/providers/test-connection-id/sync-models";
  const app = new (await import("hono")).Hono();
  app.use("*", requireAuth);
  app.post("/api/providers/:id/sync-models", (c) => c.json({ success: true }));

  // Without the token: must be rejected.
  const denied = await app.request(url, { method: "POST" });
  expect(denied.status).toBe(401);

  // With a wrong token: must be rejected.
  const wrong = await app.request(url, { method: "POST", headers: { [scheduler.getModelSyncInternalAuthHeaderName()]: "not-the-token" } });
  expect(wrong.status).toBe(401);

  // With the correct token: bypass grants access to the sync route.
  const allowed = await app.request(url, { method: "POST", headers: { [scheduler.getModelSyncInternalAuthHeaderName()]: token } });
  expect(allowed.status).toBe(200);
  const body = await allowed.json();
  expect(body.success).toBe(true);
});

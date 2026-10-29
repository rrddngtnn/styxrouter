import { expect, test } from "bun:test";

const { createProviderConnection } = await import("../src/lib/db/providers.ts");
const { createModelSyncApi } = await import("../server/modelSync.ts");

test("concurrent sync requests on the same connection are serialized", async () => {
  const conn = await createProviderConnection({ provider: "codex", authType: "oauth", accessToken: "test-only", name: "concurrency" } as any);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  const api = createModelSyncApi({ fetch: (async () => {
    calls++;
    await gate;
    return Response.json({ models: [{ slug: "gpt-6.1-terra" }] });
  }) as typeof fetch });
  const request = () => api.request(`/providers/${conn.id}/sync-models`, { method: "POST" });
  const first = request();
  const second = request();
  await new Promise((resolve) => setTimeout(resolve, 100));
  release();
  const statuses = (await Promise.all([first, second])).map((r) => r.status).sort();
  expect(statuses).toEqual([200, 409]);
  expect(calls).toBe(1);
});

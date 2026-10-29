import { existsSync, writeFileSync } from "node:fs";
const { createModelSyncApi } = await import("../../server/modelSync.ts");
const [id, started, release] = process.argv.slice(2);
const api = createModelSyncApi({ fetch: (async () => {
  writeFileSync(started, "ready");
  const deadline = Date.now() + 15000;
  while (!existsSync(release) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  if (!existsSync(release)) throw new Error("gate timeout");
  return Response.json({ models: [{ slug: "fence-model", context_window: 310000 }] });
}) as typeof fetch });
const result = await api.request(`/providers/${id}/sync-models`, { method: "POST" });
console.log(`WORKER_STATUS=${result.status}`);

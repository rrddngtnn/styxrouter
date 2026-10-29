import { createModelSyncApi } from "../../server/modelSync";
const api = createModelSyncApi({ fetch: (async () => Response.json({ models: [{ slug: "gpt-6.1-terra", context_window: 234567 }] })) as typeof fetch });
const response = await api.request(`/providers/${process.argv[2]}/sync-models`, { method: "POST" });
console.log(`SYNC_STATUS=${response.status}`);

import { expect, test } from "bun:test";
import { createProviderConnection, getProviderConnectionById } from "../src/lib/db/providers";
import { getCachedRawProviderConnections, getCachedProviderConnectionById } from "../src/lib/db/readCache";

test("bulk tags and cooldown release invalidate another process's primed connection caches", async () => {
  const c = await createProviderConnection({ provider: "openai", authType: "apikey", name: "cross-process-cache-fixture", apiKey: "fixture-key" } as any);
  const run = async (code: string) => {
    const p = Bun.spawn([process.execPath, "-e", code], { cwd: process.cwd(), env: process.env, stdout: "pipe", stderr: "pipe" });
    const [status, stderr] = await Promise.all([p.exited, new Response(p.stderr).text()]);
    expect({ status, stderr }).toEqual({ status: 0, stderr: "" });
  };
  await run(`import {updateProviderConnection} from './src/lib/db/providers.ts'; await updateProviderConnection(${JSON.stringify(c.id)}, {rateLimitedUntil:'2099-01-01T00:00:00.000Z', backoffLevel:3, testStatus:'rate_limited'});`);
  const { getDbInstance } = await import("../src/lib/db/core");
  getDbInstance().exec("CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL, action TEXT NOT NULL, actor TEXT NOT NULL, target TEXT, details TEXT, resource_type TEXT, status TEXT, metadata TEXT)");
  const filter = { provider: "openai" };
  const before = (await getCachedRawProviderConnections(filter) as any[]).find(row => row.id === c.id);
  expect(before.rateLimitedUntil).toBe("2099-01-01T00:00:00.000Z");
  await getCachedProviderConnectionById(c.id);
  await run(`import {patchProviderConnectionTagsWithAudit,releaseProviderConnectionCooldownWithAudit} from './src/lib/db/providers.ts'; const id=${JSON.stringify(c.id)}; if (!patchProviderConnectionTagsWithAudit(id,'add',['blue']).success || !releaseProviderConnectionCooldownWithAudit(id).success) throw Error('mutation failed');`);
  const stored = await getProviderConnectionById(c.id) as any;
  expect(stored.providerSpecificData.tags).toEqual(["blue"]);
  expect(stored.rateLimitedUntil == null).toBe(true);
  const raw = (await getCachedRawProviderConnections(filter) as any[]).find(row => row.id === c.id);
  const byId = await getCachedProviderConnectionById(c.id) as any;
  expect({ rawTags: raw.providerSpecificData?.tags, rawCooldownCleared: raw.rateLimitedUntil == null, byIdTags: byId.providerSpecificData?.tags, byIdCooldownCleared: byId.rateLimitedUntil == null }).toEqual({ rawTags: ["blue"], rawCooldownCleared: true, byIdTags: ["blue"], byIdCooldownCleared: true });
}, 60000);

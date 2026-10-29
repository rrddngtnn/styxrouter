import { expect, test } from "bun:test";
import { getDbInstance } from "../src/lib/db/core";
import { createProviderConnection } from "../src/lib/db/providers";
import { createPool } from "../src/lib/db/quotaPools";
import { createGroup, renameGroup } from "../src/lib/db/quotaGroups";
import { getComboByName, getComboById, getCombos, getComboByNameInsensitive } from "../src/lib/db/combos";
import { getCombosCached, clearCombosCache } from "../open-sse/handlers/chatCore/comboContextCache";
import { syncQuotaCombos } from "../src/lib/quota/quotaCombos";
import { resolveCachedCatalogResponse } from "../src/app/api/v1/models/catalogCache";

// Raw writes simulate another writer dying before its async maintenance runs.
test("all facade combo readers recover after source mutation without a worker", async () => {
  const a = await createProviderConnection({ provider: "openai", authType: "apikey", apiKey: "test", name: "recovery-a" });
  const b = await createProviderConnection({ provider: "openai", authType: "apikey", apiKey: "test", name: "recovery-b" });
  const group = createGroup("Recovery");
  const pool = createPool({ connectionId: a.id, name: "recovery", groupId: group.id });
  await syncQuotaCombos(pool.id);
  const old = (await getCombos()).find(c => String(c.name).startsWith("qtSd/recovery/"))!;
  const db = getDbInstance();
  const change = (connectionId: string) => db.immediate(() => {
    db.prepare("DELETE FROM quota_pool_connections WHERE pool_id = ?").run(pool.id);
    db.prepare("INSERT INTO quota_pool_connections (pool_id, connection_id) VALUES (?, ?)").run(pool.id, connectionId);
    db.prepare("UPDATE quota_pools SET connection_id = ? WHERE id = ?").run(connectionId, pool.id);
  });
  change(b.id);
  expect((await getComboByName(String(old.name)))?.models).toEqual(expect.arrayContaining([expect.objectContaining({ connectionId: b.id })]));
  change(a.id);
  expect((await getComboById(String(old.id)))?.models).toEqual(expect.arrayContaining([expect.objectContaining({ connectionId: a.id })]));
  change(b.id);
  expect((await getComboByNameInsensitive(String(old.name).toUpperCase()))?.models).toEqual(expect.arrayContaining([expect.objectContaining({ connectionId: b.id })]));
  renameGroup(group.id, "Renamed Recovery");
  const names = (await getCombos()).map(c => String(c.name));
  expect(names.some(name => name.startsWith("qtSd/recovery/"))).toBe(false);
  expect(names.some(name => name.startsWith("qtSd/renamedrecovery/"))).toBe(true);
  clearCombosCache();
  await getCombosCached(); // Prime the nested-routing cache at this generation.
  renameGroup(group.id, "Cache Recovery");
  const cachedNames = (await getCombosCached() as any[]).map(c => String(c.name));
  expect(cachedNames.some(name => name.startsWith("qtSd/renamedrecovery/"))).toBe(false);
  expect(cachedNames.some(name => name.startsWith("qtSd/cacherecovery/"))).toBe(true);

  const request = new Request("http://localhost/v1/models");
  const headers = { corsHeaders: {}, diagnosticHeaders: {} };
  const build = async () => ({ body: JSON.stringify((await getCombos()).map(c => c.name)), headers: {}, status: 200, cacheTTL: 60000 });
  await resolveCachedCatalogResponse(request, headers, build);
  // A separate process mutates AND reconciles; no local invalidation takes place.
  const child = Bun.spawn([process.execPath, "-e", `
    const { renameGroup } = await import('./src/lib/db/quotaGroups');
    const { syncQuotaCombos } = await import('./src/lib/quota/quotaCombos');
    renameGroup(process.argv[1], 'Cross Process Recovery');
    await syncQuotaCombos(process.argv[2]);
  `, group.id, pool.id], { cwd: process.cwd(), env: process.env, stdout: "ignore", stderr: "pipe" });
  expect(await child.exited).toBe(0);
  const catalog = await (await resolveCachedCatalogResponse(request, headers, build)).json() as string[];
  expect(catalog.some(name => name.startsWith("qtSd/cacherecovery/"))).toBe(false);
  expect(catalog.some(name => name.startsWith("qtSd/crossprocessrecovery/"))).toBe(true);
});

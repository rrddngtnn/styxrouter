import { expect, test } from "bun:test";
import { createProviderConnection } from "../src/lib/db/providers";
import { getCachedProviderConnections, getCachedRawProviderConnections, getCachedProviderConnectionById } from "../src/lib/db/readCache";
import { getDbInstance } from "../src/lib/db/core";

test("opposing bulk activation changes invalidate all primed caches across processes", async () => {
  const connection = await createProviderConnection({ provider: "openai", authType: "apikey", name: "cache fixture", apiKey: "fixture-secret" } as any);
  getDbInstance().exec("CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL, action TEXT NOT NULL, actor TEXT NOT NULL, target TEXT, details TEXT, resource_type TEXT, status TEXT, metadata TEXT)");
  const read = async () => {
    const all = await getCachedProviderConnections({provider: "openai"}) as any[];
    const raw = await getCachedRawProviderConnections({provider: "openai"}) as any[];
    const byId = await getCachedProviderConnectionById(connection.id) as any;
    return [all.find(x => x.id === connection.id).isActive, raw.find(x => x.id === connection.id).isActive, byId.isActive];
  };
  const set = async (isActive: boolean) => {
    const child = Bun.spawn([process.execPath, "-e", `import {setProviderConnectionActiveWithAudit} from './src/lib/db/providers.ts'; if (!setProviderConnectionActiveWithAudit(${JSON.stringify(connection.id)}, ${isActive}).success) throw Error('failed');`], { cwd: process.cwd(), env: process.env, stdout: "pipe", stderr: "pipe" });
    const [status, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect({status, stderr}).toEqual({status: 0, stderr: ""});
  };
  expect(await read()).toEqual([true, true, true]);
  await set(false);
  expect(await read()).toEqual([false, false, false]);
  await set(true);
  expect(await read()).toEqual([true, true, true]);
}, 60000);

import { expect, spyOn, test } from "bun:test";
import * as providers from "../src/lib/db/providers";
import { getDbInstance } from "../src/lib/db/core";
import { getCatalogContextRevision } from "../src/lib/db/catalogContextRevision";
import { getCachedRawProviderConnections, getCachedProviderConnectionById, getCachedProviderConnections, invalidateDbCache } from "../src/lib/db/readCache";

async function worker(code: string) {
  const p = Bun.spawn([process.execPath, "-e", code], { cwd: process.cwd(), env: process.env, stdout: "pipe", stderr: "pipe" });
  const [status, stderr] = await Promise.all([p.exited, new Response(p.stderr).text()]);
  expect({status, stderr}).toEqual({status: 0, stderr: ""});
}

test("connection generation tracks all writes atomically including rollback", async () => {
  const db = getDbInstance();
  let rev = getCatalogContextRevision();
  const c = await providers.createProviderConnection({provider: "openai", authType: "apikey", name: "generation-fixture", apiKey: "fixture"} as any);
  expect(getCatalogContextRevision()).toBeGreaterThan(rev); rev = getCatalogContextRevision();
  db.exec("BEGIN IMMEDIATE");
  db.prepare("UPDATE provider_connections SET is_active = 0 WHERE id = ?").run(c.id);
  expect(getCatalogContextRevision()).toBeGreaterThan(rev);
  db.exec("ROLLBACK");
  expect(getCatalogContextRevision()).toBe(rev);
  await providers.updateProviderConnection(c.id, {isActive: false} as any);
  expect(getCatalogContextRevision()).toBeGreaterThan(rev); rev = getCatalogContextRevision();
  await providers.updateProviderConnection(c.id, {rateLimitedUntil: "2099-01-01T00:00:00.000Z"} as any);
  expect(getCatalogContextRevision()).toBeGreaterThan(rev); rev = getCatalogContextRevision();
  await providers.deleteProviderConnection(c.id);
  expect(getCatalogContextRevision()).toBeGreaterThan(rev);
});

test("older in-flight build cannot overwrite a newer generation after ABA", async () => {
  const c = await providers.createProviderConnection({provider: "openai", authType: "apikey", name: "aba-fixture", apiKey: "fixture"} as any);
  invalidateDbCache("connections");
  const original = providers.getRawProviderConnections;
  let started!: () => void, release!: () => void;
  const ready = new Promise<void>(r => { started = r; });
  const gate = new Promise<void>(r => { release = r; });
  let calls = 0;
  const spy = spyOn(providers, "getRawProviderConnections").mockImplementation(async (...args) => {
    const result = await original(...args);
    if (++calls === 1) { started(); await gate; }
    return result;
  });
  try {
    const filter = {provider: "openai"};
    const old = getCachedRawProviderConnections(filter);
    await ready;
    await worker(`import {updateProviderConnection} from './src/lib/db/providers.ts'; await updateProviderConnection(${JSON.stringify(c.id)}, {isActive:false}); await updateProviderConnection(${JSON.stringify(c.id)}, {isActive:true, name:'new-generation'});`);
    expect((await getCachedRawProviderConnections(filter) as any[]).find(x => x.id === c.id).name).toBe("new-generation");
    release(); await old;
    expect((await getCachedRawProviderConnections(filter) as any[]).find(x => x.id === c.id).name).toBe("new-generation");
    expect((await getCachedProviderConnections(filter) as any[]).find(x => x.id === c.id).name).toBe("new-generation");
    expect((await getCachedProviderConnectionById(c.id) as any).name).toBe("new-generation");
    expect(calls).toBe(2);
  } finally { release(); spy.mockRestore(); await providers.deleteProviderConnection(c.id); }
}, 60000);

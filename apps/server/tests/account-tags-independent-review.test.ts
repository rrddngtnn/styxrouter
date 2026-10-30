import "./helpers/test-secrets";
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { startTestServer } from "./helpers/start-test-server";
import { stopTestProcess } from "./helpers/stop-test-process";

test("adding a tag preserves existing legacy comma-separated routing tags", async () => {
  const server = await startTestServer(process.execPath, { cwd: `${import.meta.dir}/..`, env: { ...process.env, STYX_TEST_MODE: "1", JWT_SECRET: "fixture-jwt-secret-01234567890123456789", INITIAL_PASSWORD: "fixture-password", STORAGE_ENCRYPTION_KEY: "fixture-encryption-key" } });
  try {
    const login = await fetch(server.base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "fixture-password" }) });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const post = (path: string, body: unknown) => fetch(server.base + path, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) });
    const { id } = await (await post("/api/connections", { provider: "openai", name: "legacy", apiKey: "fixture-key" })).json() as any;
    const db = new Database(`${process.env.STYX_DATA_DIR}/storage.sqlite`);
    try {
      db.query("UPDATE provider_connections SET provider_specific_data = ? WHERE id = ?").run(JSON.stringify({ tags: "Red, blue", unrelated: { n: 1 } }), id);
      const result = await (await post("/api/connections/bulk-tags", { ids: [id], operation: "add", tags: ["green"] })).json() as any;
      expect(result.results[0].tags).toEqual(["red", "blue", "green"]);
      const data = JSON.parse((db.query("SELECT provider_specific_data FROM provider_connections WHERE id = ?").get(id) as any).provider_specific_data);
      expect(data.unrelated).toEqual({ n: 1 });
    } finally { db.close(); }
  } finally { await stopTestProcess(server.proc); }
}, 60000);

test("provider metadata updates based on a stale snapshot do not erase new routing tags", async () => {
  const { createProviderConnection, getProviderConnectionById, updateProviderConnection, patchProviderConnectionTagsWithAudit } = await import("../src/lib/db/providers");
  const conn = await createProviderConnection({ provider: "openai", authType: "apikey", name: "race", apiKey: "fixture-key", providerSpecificData: { info: "before" } } as any);
  const snapshot = await getProviderConnectionById(conn.id) as any;
  expect(patchProviderConnectionTagsWithAudit(conn.id, "add", ["blue"]).success).toBe(true);
  await updateProviderConnection(conn.id, { providerSpecificData: { ...snapshot.providerSpecificData, info: "after" } });
  const result = await getProviderConnectionById(conn.id) as any;
  expect(result.providerSpecificData).toMatchObject({ info: "after", tags: ["blue"] });
  const stale = result.providerSpecificData;
  expect(patchProviderConnectionTagsWithAudit(conn.id, "add", ["green"]).success).toBe(true);
  await updateProviderConnection(conn.id, { providerSpecificData: { ...stale, info: "later" } });
  expect((await getProviderConnectionById(conn.id) as any).providerSpecificData.tags).toEqual(["blue", "green"]);
  await updateProviderConnection(conn.id, { providerSpecificData: { info: "explicit", tags: ["red"] } }, { tags: "replace" });
  expect((await getProviderConnectionById(conn.id) as any).providerSpecificData.tags).toEqual(["red"]);
  await updateProviderConnection(conn.id, { providerSpecificData: { info: "clear", tags: [] } }, { tags: "replace" });
  expect((await getProviderConnectionById(conn.id) as any).providerSpecificData.tags ?? []).toEqual([]);
});

test("separate process stale metadata and upsert preserve tags and encrypted credentials", async () => {
  const { createProviderConnection, patchProviderConnectionTagsWithAudit, getProviderConnectionById } = await import("../src/lib/db/providers");
  const conn = await createProviderConnection({ provider: "openai", authType: "apikey", name: "cross-process-tags", apiKey: "cross-process-fixture-key", providerSpecificData: { info: "old" } } as any);
  const modulePath = `${import.meta.dir}/../src/lib/db/providers.ts`;
  const run = (code: string) => Bun.spawnSync({ cmd: [process.execPath, "-e", code], cwd: `${import.meta.dir}/..`, env: process.env, stdout: "pipe", stderr: "pipe" });
  const snapshot = run(`import {getProviderConnectionById} from ${JSON.stringify(modulePath)}; const c=await getProviderConnectionById(${JSON.stringify(conn.id)}); console.log('SNAPSHOT:'+JSON.stringify(c.providerSpecificData));`);
  expect(snapshot.exitCode).toBe(0);
  const line = snapshot.stdout.toString().split("\n").find(line => line.startsWith("SNAPSHOT:"))!;
  const old = JSON.parse(line.slice(9));
  expect(patchProviderConnectionTagsWithAudit(conn.id, "add", ["blue"]).success).toBe(true);
  const write = run(`import {updateProviderConnection,createProviderConnection} from ${JSON.stringify(modulePath)}; await updateProviderConnection(${JSON.stringify(conn.id)}, {providerSpecificData:{...${JSON.stringify(old)},info:'new'}}); await createProviderConnection({provider:'openai',authType:'apikey',name:'cross-process-tags',providerSpecificData:{info:'upsert'}});`);
  expect(write.exitCode).toBe(0);
  const result = await getProviderConnectionById(conn.id) as any;
  expect(result.providerSpecificData).toMatchObject({ info: "upsert", tags: ["blue"] });
  expect(result.apiKey).toBe("cross-process-fixture-key");
}, 60000);

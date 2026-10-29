import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { startTestServer } from "./helpers/start-test-server";
import { stopTestProcess } from "./helpers/stop-test-process";
import { spawn } from "node:child_process";

test("real admin routes and stale OAuth metadata from another process preserve bulk tags", async () => {
  const env = { ...process.env, STYX_TEST_MODE: "1", JWT_SECRET: "fixture-jwt-secret-01234567890123456789", INITIAL_PASSWORD: "fixture-password", STORAGE_ENCRYPTION_KEY: "fixture-encryption-key" };
  const server = await startTestServer(process.execPath, { cwd: `${import.meta.dir}/..`, env });
  let worker: ReturnType<typeof spawn> | undefined;
  try {
    const login = await fetch(server.base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "fixture-password" }) });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const call = (method: string, path: string, body: unknown) => fetch(server.base + path, { method, headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) });
    const created = await call("POST", "/api/connections", { provider: "openai", name: "ownership", apiKey: "synthetic-ownership-key" });
    expect(created.status).toBe(201);
    const { id } = await created.json() as any;
    expect((await call("PATCH", `/api/connections/${id}`, { name: "ownership-renamed" })).status).toBe(200);
    // This strict admin endpoint never accepted arbitrary provider metadata or tags.
    expect((await call("PATCH", `/api/connections/${id}`, { providerSpecificData: { tags: ["direct"] } })).status).toBe(400);
    expect((await call("PATCH", `/api/connections/${id}`, { tags: ["direct"] })).status).toBe(400);
    const bulk = async (tags: string[]) => {
      const response = await call("POST", "/api/connections/bulk-tags", { ids: [id], operation: "add", tags });
      expect(response.status).toBe(200);
      expect((await response.json() as any).results[0].success).toBe(true);
    };
    await bulk(["blue"]);
    const upsert = await call("POST", "/api/connections", { provider: "openai", name: "ownership-renamed", apiKey: "synthetic-ownership-key" });
    expect(upsert.status).toBe(201);
    expect((await upsert.json() as any).id).toBe(id);
    const modulePath = `${import.meta.dir}/../src/lib/db/providers.ts`;
    const code = `import {getProviderConnectionById, updateProviderConnection} from ${JSON.stringify(modulePath)}; const old=await getProviderConnectionById(${JSON.stringify(id)}); console.log('READY'); for await (const chunk of Bun.stdin.stream()) { await updateProviderConnection(${JSON.stringify(id)}, {providerSpecificData:{...old.providerSpecificData, oauthMetadata:'renewed'}}); console.log('DONE'); break; }`;
    worker = spawn(process.execPath, ["-e", code], { cwd: `${import.meta.dir}/..`, env, stdio: ["pipe", "pipe", "pipe"] });
    let output = "", errors = "";
    worker.stderr!.on("data", chunk => { errors += chunk; });
    const waitFor = (marker: string) => new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`worker timeout: ${output} ${errors}`)), 20000);
      const check = () => { if (output.includes(marker)) { clearTimeout(timer); resolve(); } };
      worker!.stdout!.on("data", chunk => { output += chunk; check(); });
      worker!.once("exit", code => { if (!output.includes(marker)) { clearTimeout(timer); reject(new Error(`worker exit ${code}: ${errors}`)); } });
      check();
    });
    await waitFor("READY");
    await bulk(["green"]);
    worker.stdin!.write("go\n");
    await waitFor("DONE");
    const db = new Database(`${process.env.STYX_DATA_DIR}/storage.sqlite`, { readonly: true });
    try {
      const row = db.query("SELECT provider_specific_data FROM provider_connections WHERE id = ?").get(id) as any;
      expect(JSON.parse(row.provider_specific_data)).toMatchObject({ tags: ["blue", "green"], oauthMetadata: "renewed" });
    } finally { db.close(); }
    // Exercise the mounted OAuth completion route without contacting a vendor.
    const jwt = `e30.${Buffer.from(JSON.stringify({ email: "fixture@example.test", "https://api.openai.com/auth": { chatgpt_user_id: "fixture-user", chatgpt_account_id: "fixture-workspace" } })).toString("base64url")}.sig`;
    const complete = (connectionId?: string) => call("POST", "/api/oauth/codex/device-complete", { access_token: "fixture-access", refresh_token: "fixture-refresh", id_token: jwt, expires_in: 3600, ...(connectionId ? { connectionId } : {}) });
    const oauthCreated = await complete();
    expect(oauthCreated.status).toBe(200);
    const oauthId = (await oauthCreated.json() as any).connection.id;
    const tagResponse = await call("POST", "/api/connections/bulk-tags", { ids: [oauthId], operation: "add", tags: ["oauth"] });
    expect((await tagResponse.json() as any).results[0].success).toBe(true);
    const oauthUpdated = await complete(oauthId);
    expect(oauthUpdated.status).toBe(200);
    expect((await oauthUpdated.json() as any).connection.id).toBe(oauthId);
    const oauthDb = new Database(`${process.env.STYX_DATA_DIR}/storage.sqlite`, { readonly: true });
    try {
      const row = oauthDb.query("SELECT provider_specific_data FROM provider_connections WHERE id = ?").get(oauthId) as any;
      expect(JSON.parse(row.provider_specific_data).tags).toEqual(["oauth"]);
    } finally { oauthDb.close(); }
    const list = await fetch(server.base + "/api/connections", { headers: { cookie } });
    expect((await list.json() as any).connections.find((entry: any) => entry.id === id).tags).toEqual(["blue", "green"]);
  } finally {
    if (worker) await stopTestProcess(worker);
    await stopTestProcess(server.proc);
  }
}, 60000);

import { afterAll, beforeAll, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";

const root = join(import.meta.dir, "..");
const dir = mkdtempSync(join(tmpdir(), "import-auth-"));
let proc: ReturnType<typeof spawn>, base = "", cookie = "", key = "", ids: string[] = [];
let status = 401;
let upstreamMessage = "upstream rejected credential";
const calls: string[] = [];
const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
  calls.push(request.headers.get("authorization") ?? "");
  return Response.json({ error: { message: upstreamMessage } }, { status });
}});
const env = { ...process.env, DATA_DIR: dir, STYX_TEST_MODE: "1", MOCK_UPSTREAM_PORT: String(upstream.port), JWT_SECRET: "import-auth-jwt-secret-0123456789", API_KEY_SECRET: "import-auth-api-secret-0123456789", STORAGE_ENCRYPTION_KEY: "import-auth-encryption-key", INITIAL_PASSWORD: "import-auth-password" };
beforeAll(async () => {
  // Unpinned revocation cases consume active LRU accounts. Keep spare accounts
  // ahead of the quota fixture so those cases cannot expire its credential.
  const made = spawnSync(process.execPath, ["-e", `const {createApiKey}=await import('./src/lib/db/apiKeys.ts'); const {createProviderConnection}=await import('./src/lib/db/providers.ts'); const {createCombo}=await import('./src/lib/db/combos.ts'); const key=(await createApiKey('import-auth','test')).key; const ids=[]; for (const token of ['synthetic-bad-token','synthetic-sibling-token','synthetic-combo-token','synthetic-messages-token','synthetic-responses-token','synthetic-rr-token','synthetic-revoke-spare-1','synthetic-revoke-spare-2','synthetic-revoke-spare-3','synthetic-quota-token']) ids.push((await createProviderConnection({provider:'codebuddy-cn',authType:'oauth',name:token,accessToken:token,isActive:true,providerSpecificData:{importedToken:true,nonRefreshable:true}})).id); ids.push((await createProviderConnection({provider:'codebuddy-cn',authType:'apikey',name:'synthetic-key',apiKey:'synthetic-api-key',isActive:true,providerSpecificData:{importedToken:true,nonRefreshable:true}})).id); await createCombo({name:'auth-combo',strategy:'priority',models:['codebuddy-cn/deepseek-v3.2','codebuddy-cn/glm-5.0']}); await createCombo({name:'auth-round-robin',strategy:'round-robin',models:['codebuddy-cn/deepseek-v3.2','codebuddy-cn/glm-5.0']}); console.log(JSON.stringify({key,ids}));`], { cwd: root, env, encoding: "utf8" });
  expect(made.status).toBe(0);
  const fixture = JSON.parse(made.stdout.trim().split("\n").pop()!);
  key = fixture.key; ids = fixture.ids;
  expect(ids).toHaveLength(11);
  expect(new Set(ids).size).toBe(ids.length);
  proc = spawn(process.execPath, [join(import.meta.dir, "helpers/token-auth-mock-server.ts")], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "", errors = "";
  proc.stderr!.on("data", c => { errors += c; });
  const port = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(errors)), 30000);
    proc.once("exit", () => { clearTimeout(timer); reject(new Error(errors)); });
    proc.stdout!.on("data", c => { output += c; const m = output.match(/(?:^|\n)STYX_TEST_LISTENING:(\d+)\r?\n/); if (m) { clearTimeout(timer); resolve(m[1]); } });
  });
  base = `http://127.0.0.1:${port}`;
  const login = await fetch(base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "import-auth-password" }) });
  cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
}, 30000);
afterAll(() => { proc?.kill("SIGKILL"); upstream.stop(true); rmSync(dir, { recursive: true, force: true }); });

test("unknown-expiry access-only upstream 401 returns reauth and persists expiry without fallback", async () => {
  const id = ids[0];
  const response = await fetch(base + "/v1/chat/completions", { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ model: "codebuddy-cn/deepseek-v3.2", messages: [{ role: "user", content: "test" }] }) });
  const text = await response.text();
  expect(response.status).toBe(401);
  expect(text).toContain("Token expired; re-import or re-authenticate");
  expect(calls).toEqual(["Bearer synthetic-bad-token"]);
  const db = new Database(join(dir, "storage.sqlite"), { readonly: true });
  const row: any = db.query("SELECT test_status, is_active FROM provider_connections WHERE id = ?").get(id);
  db.close();
  expect(row.test_status).toBe("expired");
  expect(row.is_active).toBe(0);
  const check = await fetch(base + `/api/connections/${id}/test`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: "{}" });
  expect(await check.json()).toMatchObject({ ok: false, error: "Token expired; re-import or re-authenticate" });
  const db2 = new Database(join(dir, "storage.sqlite"), { readonly: true });
  const after: any = db2.query("SELECT test_status FROM provider_connections WHERE id = ?").get(id);
  db2.close();
  expect(after.test_status).toBe("expired");
}, 30000);

test("combo stops on access-only upstream rejection", async () => {
  calls.length = 0;
  const response = await fetch(base + "/v1/chat/completions", { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ model: "auth-combo", messages: [{ role: "user", content: "test" }] }) });
  const text = await response.text();
  expect(response.status).toBe(401);
  expect(text).toContain("Token expired; re-import or re-authenticate");
  expect(calls.length).toBe(1);
}, 30000);

test("round-robin combo surfaces access-only 403 without disabling or falling back", async () => {
  calls.length = 0; status = 403;
  const response = await fetch(base + "/v1/chat/completions", { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ model: "auth-round-robin", messages: [{ role: "user", content: "test" }] }) });
  expect(response.status).toBe(403);
  expect(await response.text()).not.toContain("Token expired");
  expect(calls.length).toBe(1);
  const db = new Database(join(dir, "storage.sqlite"), { readonly: true });
  const rows: any[] = db.query("SELECT name, test_status, is_active FROM provider_connections").all();
  db.close();
  const row = rows.find(row => calls[0] === `Bearer ${row.name}`);
  expect(row).toBeDefined();
  expect(row.is_active).toBe(1);
  expect(row.test_status).not.toBe("expired");
}, 30000);

for (const stream of [false, true]) {
  for (const [model, message] of [
    ["auth-combo", "model permission denied"],
    ["auth-round-robin", "quota exhausted"],
    ["codebuddy-cn/deepseek-v3.2", "forbidden synthetic-secret-must-not-leak"],
  ]) {
    test(`${model} stream=${stream}: 403 ${message} stays active and never falls back`, async () => {
      calls.length = 0; status = 403; upstreamMessage = message;
      const response = await fetch(base + "/v1/chat/completions", { method: "POST", headers: {
        authorization: `Bearer ${key}`, "content-type": "application/json",
        ...(model.startsWith("codebuddy-cn/") ? { "x-styx-connection": ids[3] } : {}),
      }, body: JSON.stringify({ model, stream, messages: [{ role: "user", content: "test" }] }) });
      const text = await response.text();
      expect(response.status).toBe(403);
      expect(text).toContain("IMPORTED_TOKEN_FORBIDDEN");
      expect(text).not.toContain("Token expired");
      expect(text).not.toContain("synthetic-secret-must-not-leak");
      expect(calls.length).toBe(1);
      if (model.startsWith("codebuddy-cn/")) expect(calls[0]).toBe("Bearer synthetic-messages-token");
      const db = new Database(join(dir, "storage.sqlite"), { readonly: true });
      const rows: any[] = db.query("SELECT name, test_status, is_active FROM provider_connections").all();
      db.close();
      const row = rows.find(row => calls[0] === `Bearer ${row.name}`);
      expect(row).toBeDefined();
      expect(row.is_active).toBe(1);
      expect(row.test_status).not.toBe("expired");
      expect(row.test_status).not.toBe("banned");
    }, 30000);
  }
}

for (const [path, body, id] of [
  ["/v1/messages", { model: "codebuddy-cn/deepseek-v3.2", max_tokens: 8, messages: [{ role: "user", content: "test" }] }, 3],
  ["/v1/responses", { model: "codebuddy-cn/deepseek-v3.2", input: "test", stream: false }, 4],
] as const) {
  test(`${path} surfaces upstream 403 without disabling the account`, async () => {
    calls.length = 0; status = 403;
    const response = await fetch(base + path, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "x-styx-connection": ids[id] }, body: JSON.stringify(body) });
    const text = await response.text();
    expect(response.status).toBe(403);
    expect(text).toContain("IMPORTED_TOKEN_FORBIDDEN");
    expect(text).not.toContain("Token expired");
    expect(calls).toEqual([`Bearer synthetic-${id === 3 ? "messages" : "responses"}-token`]);
    const db = new Database(join(dir, "storage.sqlite"), { readonly: true });
    const row: any = db.query("SELECT test_status, is_active FROM provider_connections WHERE id = ?").get(ids[id]);
    db.close();
    expect(row.test_status).not.toBe("expired");
    expect(row.is_active).toBe(1);
  }, 30000);
}

for (const [model, stream] of [["auth-combo", true], ["auth-round-robin", true], ["codebuddy-cn/deepseek-v3.2", true]] as const) {
  test(`${model} stream=${stream}: revoked access-only token returns 401 without fallback`, async () => {
    calls.length = 0; status = 401;
    const response = await fetch(base + "/v1/chat/completions", { method: "POST", headers: {
      authorization: `Bearer ${key}`, "content-type": "application/json",
    }, body: JSON.stringify({ model, stream, messages: [{ role: "user", content: "test" }] }) });
    expect(response.status).toBe(401);
    expect(await response.text()).toContain("IMPORTED_TOKEN_REAUTH_REQUIRED");
    expect(calls.length).toBe(1);
    const db = new Database(join(dir, "storage.sqlite"), { readonly: true });
    const rows: any[] = db.query("SELECT name, test_status, is_active FROM provider_connections").all();
    db.close();
    const row = rows.find(row => calls[0] === `Bearer ${row.name}`);
    expect(row).toBeDefined();
    expect(row.test_status).toBe("expired");
    expect(row.is_active).toBe(0);
  }, 30000);
}

for (const [label, id, upstreamStatus] of [["quota", 9, 429], ["API key", 10, 401]] as const) {
  test(`${label} failure does not receive the imported OAuth reauth response`, async () => {
    calls.length = 0; status = upstreamStatus;
    // This must exercise an upstream rejection, not local expired-account selection.
    const beforeDb = new Database(join(dir, "storage.sqlite"), { readonly: true });
    const before: any = beforeDb.query("SELECT is_active, test_status FROM provider_connections WHERE id = ?").get(ids[id]);
    beforeDb.close();
    expect(before.is_active).toBe(1);
    expect(before.test_status).not.toBe("expired");
    const response = await fetch(base + "/v1/chat/completions", { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "x-styx-connection": ids[id] }, body: JSON.stringify({ model: "codebuddy-cn/deepseek-v3.2", messages: [{ role: "user", content: "test" }] }) });
    expect(await response.text()).not.toContain("IMPORTED_TOKEN_REAUTH_REQUIRED");
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]).toBe(label === "quota" ? "Bearer synthetic-quota-token" : "Bearer synthetic-api-key");
    const db = new Database(join(dir, "storage.sqlite"), { readonly: true });
    const row: any = db.query("SELECT test_status FROM provider_connections WHERE id = ?").get(ids[id]);
    db.close();
    if (label === "quota") expect(row.test_status).not.toBe("expired");
  }, 30000);
}

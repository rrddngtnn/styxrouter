import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { startTestServer } from "./helpers/start-test-server";

const dir = mkdtempSync(join(tmpdir(), "import-password-guard-"));
const env = { ...process.env, DATA_DIR: dir, STYX_TEST_MODE: "1", JWT_SECRET: "synthetic-jwt-secret-0123456789abcdef", API_KEY_SECRET: "synthetic-api-secret-0123456789abcdef", STORAGE_ENCRYPTION_KEY: "synthetic-encryption-key", INITIAL_PASSWORD: "synthetic-password" };
let server: Awaited<ReturnType<typeof startTestServer>>, cookie: string;
let db: Database;
let originalPassword: string;
async function post(token: string, provider = "openai") {
  const response = await fetch(server.base + "/api/connections/import", { method: "POST", headers: { cookie, "content-type": "application/json", origin: server.base }, body: JSON.stringify({ provider, accounts: { token } }) });
  expect(response.status).toBe(200);
  return await response.json() as any;
}
beforeAll(async () => {
  server = await startTestServer(process.execPath, { cwd: join(import.meta.dir, ".."), env });
  const login = await fetch(server.base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "synthetic-password" }) });
  expect(login.status).toBe(200);
  cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
  db = new Database(join(dir, "storage.sqlite"));
  originalPassword = (db.query("SELECT value FROM key_value WHERE namespace='settings' AND key='password'").get() as { value: string }).value;
  db.exec("CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL DEFAULT (datetime('now')), action TEXT NOT NULL, actor TEXT NOT NULL DEFAULT 'system', target TEXT, details TEXT, ip_address TEXT, resource_type TEXT, status TEXT, request_id TEXT, metadata TEXT)");
}, 60000);
afterAll(async () => {
  db?.close();
  if (server && server.proc.exitCode === null && server.proc.signalCode === null) await new Promise<void>(resolve => { server.proc.once("exit", () => resolve()); server.proc.kill("SIGKILL"); });
  rmSync(dir, { recursive: true, force: true });
});

test("bcrypt verification errors reject imports without credential, marker or audit writes", async () => {
  db.query("UPDATE key_value SET value=? WHERE namespace='settings' AND key='password'").run(JSON.stringify("$2b$99$" + "a".repeat(53)));
  const before = {
    connections: db.query("SELECT * FROM provider_connections").all(),
    markers: db.query("SELECT * FROM key_value WHERE namespace='token_import_v1'").all(),
    audit: db.query("SELECT * FROM audit_log WHERE action='connection.import'").all(),
  };
  const body = await post("synthetic-private-api-key");
  expect(body.results[0].valid).toBe(false);
  expect(JSON.stringify(body)).not.toContain("synthetic-private-api-key");
  expect(JSON.stringify(body)).not.toContain("Illegal number of rounds");
  expect(db.query("SELECT * FROM provider_connections").all()).toEqual(before.connections);
  expect(db.query("SELECT * FROM key_value WHERE namespace='token_import_v1'").all()).toEqual(before.markers);
  expect(db.query("SELECT * FROM audit_log WHERE action='connection.import'").all()).toEqual(before.audit);
  db.query("UPDATE key_value SET value=? WHERE namespace='settings' AND key='password'").run(originalPassword);
}, 30000);

test("valid API keys remain encrypted and password matches are rejected", async () => {
  const rejected = await post("synthetic-password");
  expect(rejected.results[0].valid).toBe(false);
  const accepted = await post("synthetic-distinct-api-key");
  expect(accepted.results[0].valid).toBe(true);
  const row = db.query("SELECT api_key FROM provider_connections WHERE id=?").get(accepted.results[0].id) as { api_key: string };
  expect(row.api_key.startsWith("enc:v1:")).toBe(true);
  expect(row.api_key).not.toContain("synthetic-distinct-api-key");
  expect(JSON.stringify(accepted)).not.toContain("synthetic-distinct-api-key");
}, 30000);

test("OAuth imports bypass the API-key-only password check", async () => {
  db.query("UPDATE key_value SET value=? WHERE namespace='settings' AND key='password'").run(JSON.stringify("$2b$99$" + "a".repeat(53)));
  const body = await post("synthetic-oauth-token", "codebuddy-cn");
  expect(body.results[0].valid).toBe(true);
  const row = db.query("SELECT access_token FROM provider_connections WHERE id=?").get(body.results[0].id) as { access_token: string };
  expect(row.access_token.startsWith("enc:v1:")).toBe(true);
  db.query("UPDATE key_value SET value=? WHERE namespace='settings' AND key='password'").run(originalPassword);
}, 30000);

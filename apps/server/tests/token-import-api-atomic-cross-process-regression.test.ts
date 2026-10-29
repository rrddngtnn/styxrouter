import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { startTestServer } from "./helpers/start-test-server";

const dir = mkdtempSync(join(tmpdir(), "import-cross-process-"));
const env = { ...process.env, DATA_DIR: dir, STYX_TEST_MODE: "1", JWT_SECRET: "synthetic-jwt-secret-0123456789abcdef", API_KEY_SECRET: "synthetic-api-secret-0123456789abcdef", STORAGE_ENCRYPTION_KEY: "synthetic-cross-process-encryption", INITIAL_PASSWORD: "synthetic-password" };
let servers: Awaited<ReturnType<typeof startTestServer>>[] = [], cookies: string[] = [];
const secret = "synthetic-cross-process-access";
async function post(i: number, token: string, origin?: string) {
  return fetch(servers[i].base + "/api/connections/import", { method: "POST", headers: { cookie: cookies[i], "content-type": "application/json", origin: origin ?? servers[i].base }, body: JSON.stringify({ provider: "codebuddy-cn", accounts: { token } }) });
}
beforeAll(async () => {
  for (let i = 0; i < 2; i++) {
    const server = await startTestServer(process.execPath, { cwd: join(import.meta.dir, ".."), env });
    servers.push(server);
    const login = await fetch(server.base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "synthetic-password" }) });
    expect(login.status).toBe(200);
    cookies.push((login.headers.get("set-cookie") ?? "").split(";")[0]);
  }
}, 60000);
afterAll(async () => {
  await Promise.all(servers.map(({proc}) => new Promise<void>((resolve) => { if (proc.exitCode !== null || proc.signalCode !== null) return resolve(); proc.once("exit", () => resolve()); proc.kill("SIGKILL"); })));
  rmSync(dir, { recursive: true, force: true });
});
test("cross-process concurrent retry commits one encrypted connection and audit; audit failure rolls back", async () => {
  expect((await post(0, secret, "https://foreign.invalid")).status).toBe(403);
  const responses = await Promise.all([post(0, secret), post(1, secret)]);
  expect(responses.map(r => r.status)).toEqual([200, 200]);
  const bodies: any[] = await Promise.all(responses.map(r => r.json()));
  expect(bodies[0].results[0].id).toBeTruthy();
  expect(bodies[0].results[0].id).toBe(bodies[1].results[0].id);
  expect(JSON.stringify(bodies)).not.toContain(secret);
  const db = new Database(join(dir, "storage.sqlite"));
  expect(db.query("SELECT count(*) n FROM provider_connections").get()).toEqual({ n: 1 });
  expect(db.query("SELECT count(*) n FROM audit_log WHERE action='connection.import'").get()).toEqual({ n: 1 });
  expect(JSON.stringify(db.query("SELECT * FROM provider_connections").all())).not.toContain(secret);
  db.exec("CREATE TRIGGER reject_import_audit BEFORE INSERT ON audit_log WHEN NEW.action = 'connection.import' BEGIN SELECT RAISE(ABORT, 'synthetic-private-error'); END");
  const failed: any = await (await post(1, "synthetic-second-access")).json();
  expect(failed.results[0].valid).toBe(false);
  expect(JSON.stringify(failed)).not.toContain("synthetic");
  expect(db.query("SELECT count(*) n FROM provider_connections").get()).toEqual({ n: 1 });
  expect(db.query("SELECT count(*) n FROM key_value WHERE namespace='token_import_v1'").get()).toEqual({ n: 1 });
  db.exec("DROP TRIGGER reject_import_audit");
  db.close();
}, 30000);

test("mixed access and pair imports race across processes without duplicate or overwrite", async () => {
  const access = "synthetic-mixed-race-access", refresh = "synthetic-mixed-race-refresh";
  const send = (i: number, pair: boolean) => fetch(servers[i].base + "/api/connections/import", {
    method: "POST", headers: { cookie: cookies[i], "content-type": "application/json", origin: servers[i].base },
    body: JSON.stringify({ provider: "codebuddy-cn", accounts: pair ? { access_token: access, refresh_token: refresh } : { token: access } }),
  });
  const responses = await Promise.all([send(0, false), send(1, true)]);
  expect(responses.map(r => r.status)).toEqual([200, 200]);
  const bodies: any[] = await Promise.all(responses.map(r => r.json()));
  expect(bodies.some(b => b.results[0].valid)).toBe(true);
  expect(JSON.stringify(bodies)).not.toContain(access);
  expect(JSON.stringify(bodies)).not.toContain(refresh);
  const db = new Database(join(dir, "storage.sqlite"), { readonly: true });
  const rows = db.query("SELECT * FROM provider_connections WHERE provider = 'codebuddy-cn'").all() as any[];
  // The earlier test created one unrelated row.
  expect(rows.length).toBe(2);
  const mixed = rows.find(row => row.id === bodies.find(b => b.results[0].valid).results[0].id);
  expect(mixed.access_token).toStartWith("enc:v1:");
  if (mixed.refresh_token) expect(mixed.refresh_token).toStartWith("enc:v1:");
  expect(JSON.stringify(db.query("SELECT * FROM key_value WHERE namespace='token_import_v1'").all())).not.toContain(access);
  expect(JSON.stringify(db.query("SELECT * FROM key_value WHERE namespace='token_import_v1'").all())).not.toContain(refresh);
  expect(db.query("SELECT count(*) n FROM audit_log WHERE action='connection.import'").get()).toEqual({ n: 2 });
  db.close();
}, 30000);

test("sequential mixed imports fail safely and preserve existing access-only credentials", async () => {
  const access = "synthetic-sequential-access", refresh = "synthetic-sequential-refresh";
  const send = (account: object) => fetch(servers[0].base + "/api/connections/import", {
    method: "POST", headers: { cookie: cookies[0], "content-type": "application/json", origin: servers[0].base },
    body: JSON.stringify({ provider: "codebuddy-cn", accounts: account }),
  });
  const first: any = await (await send({ token: access })).json();
  expect(first.results[0].valid).toBe(true);
  const db = new Database(join(dir, "storage.sqlite"));
  const before = db.query("SELECT * FROM provider_connections WHERE id = ?").get(first.results[0].id);
  const second: any = await (await send({ access_token: access, refresh_token: refresh })).json();
  expect(second.results[0].valid).toBe(false);
  expect(JSON.stringify(second)).not.toContain(refresh);
  expect(db.query("SELECT * FROM provider_connections WHERE id = ?").get(first.results[0].id)).toEqual(before);
  db.close();
}, 30000);

test("batch reports mixed credential conflict per entry while saving independent entries", async () => {
  const access = "synthetic-batch-conflict-access", refresh = "synthetic-batch-conflict-refresh", other = "synthetic-batch-independent";
  const send = (accounts: object | object[]) => fetch(servers[0].base + "/api/connections/import", {
    method: "POST", headers: { cookie: cookies[0], "content-type": "application/json", origin: servers[0].base },
    body: JSON.stringify({ provider: "codebuddy-cn", accounts }),
  });
  const first: any = await (await send({ token: access })).json();
  const db = new Database(join(dir, "storage.sqlite"));
  const before = db.query("SELECT * FROM provider_connections WHERE id = ?").get(first.results[0].id);
  const result: any = await (await send([{ access_token: access, refresh_token: refresh }, { token: other }])).json();
  expect(result.results[0]).toEqual({ index: 0, valid: false, error: "Import conflicts with existing credentials; existing account was not changed" });
  expect(result.results[1].valid).toBe(true);
  expect(result.results[1].id).toBeTruthy();
  for (const secret of [access, refresh, other]) expect(JSON.stringify(result)).not.toContain(secret);
  expect(db.query("SELECT * FROM provider_connections WHERE id = ?").get(first.results[0].id)).toEqual(before);
  expect(db.query("SELECT count(*) n FROM provider_connections WHERE id = ?").get(result.results[1].id)).toEqual({ n: 1 });
  db.close();
}, 30000);

test("concurrent dormant pair retries share one encrypted row and audit", async () => {
  const access = "synthetic-dormant-race-access", refresh = "synthetic-dormant-race-refresh";
  const send = (i: number) => fetch(servers[i].base + "/api/connections/import", {
    method: "POST", headers: { cookie: cookies[i], "content-type": "application/json", origin: servers[i].base },
    body: JSON.stringify({ provider: "xai-oauth", accounts: { access_token: access, refresh_token: refresh } }),
  });
  const bodies: any[] = await Promise.all((await Promise.all([send(0), send(1)])).map(r => r.json()));
  expect(bodies[0].results[0].valid).toBe(true);
  expect(bodies[1].results[0].id).toBe(bodies[0].results[0].id);
  expect(JSON.stringify(bodies)).not.toContain(refresh);
  const db = new Database(join(dir, "storage.sqlite"), { readonly: true });
  try {
    const rows: any[] = db.query("SELECT * FROM provider_connections WHERE provider = 'xai-oauth'").all();
    expect(rows.length).toBe(1);
    expect(rows[0].access_token).toStartWith("enc:v1:");
    expect(rows[0].refresh_token).toStartWith("enc:v1:");
    expect(JSON.parse(rows[0].provider_specific_data).autoRefreshDisabled).toBe(true);
    expect(db.query("SELECT count(*) n FROM audit_log WHERE action='connection.import' AND target=?").get(rows[0].id)).toEqual({ n: 1 });
  } finally { db.close(); }
}, 30000);

test("API-key import rejects the current management password", async () => {
  const response = await fetch(servers[0].base + "/api/connections/import", { method: "POST", headers: { cookie: cookies[0], "content-type": "application/json", origin: servers[0].base }, body: JSON.stringify({ provider: "openai", accounts: { token: "synthetic-password" } }) });
  const body: any = await response.json();
  expect(body.results[0].valid).toBe(false);
  expect(JSON.stringify(body)).not.toContain("synthetic-password");
  const db = new Database(join(dir, "storage.sqlite"), { readonly: true });
  expect(db.query("SELECT count(*) n FROM provider_connections WHERE provider = 'openai'").get()).toEqual({ n: 0 });
  db.close();
});

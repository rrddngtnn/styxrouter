import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { startTestServer } from "./helpers/start-test-server";

const dir = mkdtempSync(join(tmpdir(), "kiro-review-"));
const env = { ...process.env, DATA_DIR: dir, STYX_TEST_MODE: "1", JWT_SECRET: "synthetic-jwt-secret-0123456789abcdef", API_KEY_SECRET: "synthetic-api-secret-0123456789abcdef", STORAGE_ENCRYPTION_KEY: "synthetic-kiro-review-encryption", INITIAL_PASSWORD: "synthetic-password" };
let server: Awaited<ReturnType<typeof startTestServer>>, cookie: string;
async function send(accounts: object) {
  const response = await fetch(server.base + "/api/connections/import", { method: "POST", headers: { cookie, "content-type": "application/json", origin: server.base }, body: JSON.stringify({ provider: "kiro", accounts }) });
  expect(response.status).toBe(200);
  const body: any = await response.json();
  expect(JSON.stringify(body)).not.toContain("synthetic-access");
  return body.results[0];
}
beforeAll(async () => {
  server = await startTestServer(process.execPath, { cwd: join(import.meta.dir, ".."), env });
  const login = await fetch(server.base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "synthetic-password" }) });
  expect(login.status).toBe(200);
  cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
}, 60000);
afterAll(async () => {
  if (server) await new Promise<void>(resolve => { if (server.proc.exitCode !== null || server.proc.signalCode !== null) return resolve(); server.proc.once("exit", () => resolve()); server.proc.kill("SIGKILL"); });
  rmSync(dir, { recursive: true, force: true });
});

test("rejects sibling Kiro metadata but preserves matching nested metadata", async () => {
  const bad = await send({ access_token: "synthetic-access-sibling", account: { authMethod: "social" }, credentials: { region: "us-east-1" } });
  expect(bad.valid).toBe(false);
  const good = await send({ access_token: "synthetic-access-nested", account: { authMethod: "social", credentials: { region: "us-east-1" } } });
  expect(good.valid).toBe(true);
  const db = new Database(join(dir, "storage.sqlite"), { readonly: true });
  const row: any = db.query("SELECT provider_specific_data FROM provider_connections WHERE id=?").get(good.id);
  expect(JSON.parse(row.provider_specific_data)).toMatchObject({ authMethod: "social", region: "us-east-1", importedToken: true });
  const retry = await send({ access_token: "synthetic-access-nested", account: { authMethod: "social", credentials: { region: "us-east-1" } } });
  expect(retry.id).toBe(good.id);
  const conflict = await send({ access_token: "synthetic-access-nested", authMethod: "social", region: "eu-west-1" });
  expect(conflict.valid).toBe(false);
  expect(db.query("SELECT provider_specific_data FROM provider_connections WHERE id=?").get(good.id)).toEqual(row);
  db.close();
});

test("rejects non-string authentication method", async () => {
  expect((await send({ access_token: "synthetic-access-array", authMethod: ["social"] })).valid).toBe(false);
});

test("access-only import cannot reuse ordinary OAuth row", async () => {
  const first = await send({ access_token: "synthetic-access-existing", authMethod: "social" });
  expect(first.valid).toBe(true);
  const db = new Database(join(dir, "storage.sqlite"));
  db.query("UPDATE provider_connections SET provider_specific_data=?, refresh_token=? WHERE id=?").run(JSON.stringify({ authMethod: "social" }), "synthetic-refresh-existing", first.id);
  db.query("DELETE FROM key_value WHERE namespace='token_import_v1' AND value=?").run(first.id);
  const before = db.query("SELECT * FROM provider_connections WHERE id=?").get(first.id);
  const duplicate = await send({ access_token: "synthetic-access-existing", authMethod: "social" });
  expect(duplicate.valid).toBe(false);
  expect(db.query("SELECT * FROM provider_connections WHERE id=?").get(first.id)).toEqual(before);
  expect(db.query("SELECT count(*) n FROM key_value WHERE namespace='token_import_v1' AND value=?").get(first.id)).toEqual({ n: 0 });
  db.close();
});

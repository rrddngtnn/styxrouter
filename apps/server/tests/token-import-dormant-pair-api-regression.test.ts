import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { startTestServer } from "./helpers/start-test-server";

const dir = mkdtempSync(join(tmpdir(), "dormant-pairs-"));
const env = { ...process.env, DATA_DIR: dir, STYX_TEST_MODE: "1", JWT_SECRET: "synthetic-dormant-jwt-secret-0123456789", API_KEY_SECRET: "synthetic-dormant-api-secret-0123456789", STORAGE_ENCRYPTION_KEY: "synthetic-dormant-encryption-key", INITIAL_PASSWORD: "synthetic-dormant-password" };
let server: Awaited<ReturnType<typeof startTestServer>>, cookie = "";
beforeAll(async () => {
  server = await startTestServer(process.execPath, { cwd: join(import.meta.dir, ".."), env });
  const login = await fetch(server.base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "synthetic-dormant-password" }) });
  expect(login.status).toBe(200);
  cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
}, 30000);
afterAll(async () => {
  if (server?.proc && server.proc.exitCode === null && server.proc.signalCode === null) await new Promise<void>((resolve) => { server.proc.once("exit", () => resolve()); server.proc.kill("SIGKILL"); });
  rmSync(dir, { recursive: true, force: true });
});

for (const provider of ["codebuddy-cn", "codebuddy-intl", "codex", "claude", "kimi-coding", "xai-oauth"]) {
  test(`${provider} accepts an encrypted dormant pair without claiming refresh capability`, async () => {
    const access = `synthetic-${provider}-access`, refresh = `synthetic-${provider}-refresh`;
    const response = await fetch(server.base + "/api/connections/import", { method: "POST", headers: { cookie, origin: server.base, "content-type": "application/json" }, body: JSON.stringify({ provider, accounts: { access_token: access, refresh_token: refresh } }) });
    expect(response.status).toBe(200);
    const body: any = await response.json();
    expect(JSON.stringify(body)).not.toContain(access);
    expect(JSON.stringify(body)).not.toContain(refresh);
    expect(body.results[0]).toMatchObject({ valid: true, mode: "access+refresh", refreshable: false });
    const db = new Database(join(dir, "storage.sqlite"), { readonly: true });
    try {
      const row: any = db.query("SELECT access_token, refresh_token, provider_specific_data FROM provider_connections WHERE id = ?").get(body.results[0].id);
      expect(row.access_token).toStartWith("enc:v1:");
      expect(row.refresh_token).toStartWith("enc:v1:");
      expect(JSON.stringify(row)).not.toContain(access);
      expect(JSON.stringify(row)).not.toContain(refresh);
      expect(JSON.parse(row.provider_specific_data)).toMatchObject({ importedToken: true, nonRefreshable: true, autoRefreshDisabled: true });
    } finally { db.close(); }
  }, 30000);
}

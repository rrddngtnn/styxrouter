import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { startTestServer } from "./helpers/start-test-server";

const root = join(import.meta.dir, "..");
const dir = mkdtempSync(join(tmpdir(), "styx-import-test-"));
let proc: any, base = "", cookie = "";
const access = "synthetic-access-token-0123456789";
const refresh = "synthetic-refresh-token-0123456789";
async function api(path: string, body: unknown, headers: Record<string,string> = {}) {
  return fetch(base + path, { method: "POST", headers: { cookie, "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}
beforeAll(async () => {
  ({ proc, base } = await startTestServer(process.execPath, { cwd: root, env: { ...process.env, DATA_DIR: dir, STYX_TEST_MODE: "1", JWT_SECRET: "import-jwt-secret-0123456789abcdefgh", API_KEY_SECRET: "import-api-secret-0123456789abcdef", STORAGE_ENCRYPTION_KEY: "import-test-encryption-key", INITIAL_PASSWORD: "import-test-password" } }));
  const login = await fetch(base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "import-test-password" }) });
  cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
}, 30000);
afterAll(() => { proc?.kill("SIGKILL"); rmSync(dir, { recursive: true, force: true }); });

test("imports do not overwrite an existing account with the same email", async () => {
  const first: any = await (await api("/api/connections/import", { provider: "codebuddy-cn", accounts: { token: "synthetic-account-one", email: "same@example.test" } })).json();
  const second: any = await (await api("/api/connections/import", { provider: "codebuddy-cn", accounts: { token: "synthetic-account-two", email: "same@example.test" } })).json();
  expect(first.results[0].id).not.toBe(second.results[0].id);
});

test("preview validates aliases, expiry and provider detection without leaking fields", async () => {
  const jwt = `e30.${Buffer.from(JSON.stringify({ exp: 2000000000 })).toString("base64url")}.sig`;
  const accounts = [
    { account: { auth: { token: `Bearer ${jwt}` } } },
    { providerId: "openai", credentials: { accessToken: "synthetic-a" }, expiresAt: "2035-01-01T00:00:00Z" },
    { url: "https://copilot.tencent.com/v2/chat/completions", access_token: "synthetic-b", expires_at: 2000000000 },
    { provider: "unknown-sensitive-value", accessToken: "synthetic-c" },
    { access_token: "synthetic-d", expires_at: "invalid" },
    { access_token: "synthetic-e", refreshToken: "\n" },
  ];
  const r = await api("/api/connections/import/preview", { provider: "codebuddy-cn", accounts });
  const body: any = await r.json();
  expect(body.results[0]).toMatchObject({ valid: true, providerSource: "fallback", expiresAt: "2033-05-18T03:33:20.000Z", refreshable: false });
  expect(body.results[1]).toMatchObject({ valid: true, provider: "openai", providerSource: "explicit" });
  expect(body.results[2]).toMatchObject({ valid: true, provider: "codebuddy-cn", providerSource: "host" });
  expect(body.results.slice(3).every((x: any) => !x.valid)).toBe(true);
  expect(JSON.stringify(body)).not.toContain("synthetic-");
  expect(JSON.stringify(body)).not.toContain("unknown-sensitive-value");
});

test("session and CSRF gates protect import", async () => {
  const payload = { provider: "codebuddy-cn", accounts: { token: access } };
  expect((await api("/api/connections/import/preview", payload, { cookie: "" })).status).toBe(401);
  expect((await api("/api/connections/import", payload, { origin: "https://foreign.invalid" })).status).toBe(403);
});

test("unrefreshable imported expired accounts need reauthentication", async () => {
  const result: any = await (await api("/api/connections/import", { provider: "codebuddy-cn", accounts: { accessToken: "synthetic-expired-access", expires_at: 1 } })).json();
  const id = result.results[0].id;
  const response = await api(`/api/connections/${id}/test`, {});
  expect(await response.json()).toMatchObject({ ok: false, error: "Token expired; re-import or re-authenticate" });
});

test("preview and partial import are redacted and persist only encrypted credentials", async () => {
  const input = { provider: "codebuddy-cn", accounts: [{ tokens: { access_token: access, refresh_token: refresh }, name: "Synthetic account", expires_at: 2000000000 }, { accessToken: "" }] };
  const preview = await api("/api/connections/import/preview", input);
  expect(preview.status).toBe(200);
  const p: any = await preview.json();
  expect(p.results[0]).toMatchObject({ valid: true, provider: "codebuddy-cn", providerSource: "fallback", refreshable: false });
  expect(p.results[1].valid).toBe(false);
  expect(JSON.stringify(p)).not.toContain(access);
  expect(JSON.stringify(p)).not.toContain(refresh);
  const save = await api("/api/connections/import", input);
  expect(save.status).toBe(200);
  const result: any = await save.json();
  expect(result.results[0].id).toBeTruthy();
  expect(result.results[1].valid).toBe(false);
  expect(JSON.stringify(result)).not.toContain(access);
  const db = new Database(join(dir, "storage.sqlite"), { readonly: true });
  const row: any = db.query("SELECT access_token, refresh_token FROM provider_connections WHERE id = ?").get(result.results[0].id);
  expect(row.access_token).toStartWith("enc:v1:");
  expect(row.refresh_token).toStartWith("enc:v1:");
  expect(JSON.stringify(row)).not.toContain(access);
  db.close();
});

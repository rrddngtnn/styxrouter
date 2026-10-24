/**
 * Admin account/settings contract: connected accounts can be listed (no secrets), edited,
 * released from cooldown, tested and deleted; settings can be updated; the management password
 * can be changed only with the current one. Boots a REAL server on a throwaway DATA_DIR.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const PORT = 21194;
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = "accounts-contracts-password";
const SECRET_KEY = "sk-live-secret-do-not-leak-0123456789";
const BUN = `${process.env.HOME}/.bun/bin/bun`;

let proc: ReturnType<typeof spawn> | null = null;
let dataDir = "";
let cookie = "";
let connId = "";

const env = () => ({
  ...process.env,
  PORT: String(PORT),
  DATA_DIR: dataDir,
  STYX_TEST_MODE: "1",
  JWT_SECRET: "accounts-contracts-jwt-secret-0123456789abcdef",
  API_KEY_SECRET: "accounts-contracts-api-key-secret-0123456789",
  INITIAL_PASSWORD: PASSWORD,
});

async function waitReady() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("styx test boot timed out");
}

const api = (method: string, path: string, body?: unknown) =>
  fetch(`${BASE}${path}`, {
    method,
    headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const login = (password: string) =>
  fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
const connections = async () => ((await (await api("GET", "/api/connections")).json()) as any).connections as any[];

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "styx-accounts-"));
  const made = spawnSync(
    BUN,
    [
      "-e",
      `const { createProviderConnection } = await import('./src/lib/db/providers.ts');
       const c = await createProviderConnection({ provider: 'openai', authType: 'apikey', name: 'acct-test', apiKey: '${SECRET_KEY}', isActive: true });
       const { updateProviderConnection } = await import('./src/lib/db/providers.ts');
       await updateProviderConnection(c.id, { testStatus: 'error', backoffLevel: 3, lastError: 'boom' });
       console.log('CONN_ID=' + c.id)`,
    ],
    { cwd: ROOT, env: env(), encoding: "utf8" }
  );
  connId = (made.stdout.match(/CONN_ID=(\S+)/) ?? [])[1] ?? "";
  proc = spawn(BUN, ["server/styx.ts"], { cwd: ROOT, env: env(), stdout: "ignore", stderr: "ignore" });
  await waitReady();
  cookie = ((await login(PASSWORD)).headers.get("set-cookie") ?? "").split(";")[0];
});

afterAll(() => {
  proc?.kill("SIGKILL");
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

describe("connections", () => {
  test("list shows the account and never a secret", async () => {
    expect(connId).toBeTruthy();
    const res = await api("GET", "/api/connections");
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain(SECRET_KEY);
    expect(text).not.toMatch(/"(apiKey|api_key|accessToken|access_token|refreshToken|refresh_token|idToken)"\s*:/i);
    const row = JSON.parse(text).connections.find((c: any) => c.id === connId);
    expect(row).toMatchObject({ provider: "openai", name: "acct-test", isActive: true, testStatus: "error", backoffLevel: 3 });
  });

  test("patch deactivates, renames and re-prioritises; bad input is 400; unknown id is 404", async () => {
    const r = await api("PATCH", `/api/connections/${connId}`, { isActive: false, name: "renamed", priority: 7 });
    expect(r.status).toBe(200);
    const row = (await connections()).find((c) => c.id === connId);
    // priority is a rank the DB layer re-normalises per provider (a lone connection stays 1)
    expect(row).toMatchObject({ isActive: false, name: "renamed", priority: 1 });
    expect((await api("PATCH", `/api/connections/${connId}`, { priority: "high" })).status).toBe(400);
    expect((await api("PATCH", `/api/connections/${connId}`, { apiKey: "sk-x" })).status).toBe(400); // secrets are not editable here
    expect((await api("PATCH", "/api/connections/nope", { isActive: true })).status).toBe(404);
  });

  test("release-cooldown clears the backoff and the error", async () => {
    expect((await api("POST", `/api/connections/${connId}/release-cooldown`)).status).toBe(200);
    const row = (await connections()).find((c) => c.id === connId);
    expect(row.backoffLevel).toBe(0);
    expect(row.testStatus).toBe("active");
    expect(row.lastError).toBeNull();
    expect((await api("POST", "/api/connections/nope/release-cooldown")).status).toBe(404);
  });

  test("test reports ok true/false without throwing; unknown id is 404", async () => {
    const r = await api("POST", `/api/connections/${connId}/test`);
    expect(r.status).toBe(200);
    const body: any = await r.json();
    expect(typeof body.ok).toBe("boolean");
    expect((await api("POST", "/api/connections/nope/test")).status).toBe(404);
  });

  test("delete removes it; a second delete is 404", async () => {
    expect((await api("DELETE", `/api/connections/${connId}`)).status).toBe(200);
    expect((await connections()).some((c) => c.id === connId)).toBe(false);
    expect((await api("DELETE", `/api/connections/${connId}`)).status).toBe(404);
  });
});

describe("add an API-key account", () => {
  let newId = "";

  test("creates the account; the list shows it and never the key", async () => {
    const key = "sk-added-through-the-panel-0123456789";
    const r = await api("POST", "/api/connections", { provider: "openai", name: "added", apiKey: key });
    expect(r.status).toBe(201);
    newId = ((await r.json()) as any).id;
    expect(newId).toBeTruthy();
    const text = await (await api("GET", "/api/connections")).text();
    expect(text).not.toContain(key);
    expect(JSON.parse(text).connections.find((c: any) => c.id === newId)).toMatchObject({ provider: "openai", name: "added", isActive: true, authType: "apikey" });
  });

  test("refuses an unknown provider, a provider without API-key auth, and a missing key", async () => {
    expect((await api("POST", "/api/connections", { provider: "no-such-provider", name: "x", apiKey: "sk-0123456789abcdef" })).status).toBe(400);
    expect((await api("POST", "/api/connections", { provider: "zcode", name: "x", apiKey: "sk-0123456789abcdef" })).status).toBe(400);
    expect((await api("POST", "/api/connections", { provider: "openai", name: "x" })).status).toBe(400);
    expect((await api("POST", "/api/connections", { provider: "openai", name: "x", apiKey: "short" })).status).toBe(400);
  });

  test("without a session it is 401", async () => {
    const r = await fetch(`${BASE}/api/connections`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "openai", name: "x", apiKey: "sk-0123456789abcdef" }) });
    expect(r.status).toBe(401);
  });

  test("the new account can be deleted again", async () => {
    expect((await api("DELETE", `/api/connections/${newId}`)).status).toBe(200);
  });
});

describe("settings", () => {
  test("patch updates a setting and the read shows it", async () => {
    const r = await api("PATCH", "/api/settings", { instanceName: "Styx Test" });
    expect(r.status).toBe(200);
    const read: any = await (await api("GET", "/api/settings")).json();
    expect(read.instanceName).toBe("Styx Test");
    expect(Object.keys(read)).not.toContain("password");
  });

  test("unknown keys and password fields are refused here", async () => {
    expect((await api("PATCH", "/api/settings", { definitelyNotASetting: 1 })).status).toBe(400);
    expect((await api("PATCH", "/api/settings", { newPassword: "a-new-long-password" })).status).toBe(400);
    expect((await api("PATCH", "/api/settings", { password: "plain" })).status).toBe(400);
  });
});

describe("management password", () => {
  test("wrong current password is 401; a short new one is 400", async () => {
    expect((await api("POST", "/api/auth/password", { currentPassword: "nope", newPassword: "a-much-longer-password" })).status).toBe(401);
    expect((await api("POST", "/api/auth/password", { currentPassword: PASSWORD, newPassword: "short" })).status).toBe(400);
  });

  test("without a session it is 401", async () => {
    const r = await fetch(`${BASE}/api/auth/password`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: PASSWORD, newPassword: "a-much-longer-password" }),
    });
    expect(r.status).toBe(401);
  });

  test("the right current password changes it: the new one logs in, the old one does not", async () => {
    const r = await api("POST", "/api/auth/password", { currentPassword: PASSWORD, newPassword: "a-much-longer-password" });
    expect(r.status).toBe(200);
    expect((await login("a-much-longer-password")).status).toBe(200);
    expect((await login(PASSWORD)).status).toBe(401);
  });
});

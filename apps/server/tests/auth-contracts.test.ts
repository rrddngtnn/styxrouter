/**
 * Auth contract: the Hono host must enforce authentication itself.
 *
 *  - /api/* (except health and the three auth routes) needs a dashboard session cookie
 *  - /v1/* needs a valid API key (a session may read /v1/models for the panel)
 *  - login checks the management password; a forged or foreign-signed cookie is refused
 *  - cookie-authenticated writes from a foreign Origin are refused (CSRF)
 *  - /api/settings never returns the password hash
 *
 * Boots a REAL server on a throwaway DATA_DIR; nothing touches the operator DB.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SignJWT } from "jose";

const ROOT = join(import.meta.dir, "..");
const PORT = 21198;
const BASE = `http://127.0.0.1:${PORT}`;
const SECRET = "test-jwt-secret-0123456789abcdef0123456789abcdef";
const PASSWORD = "correct horse battery staple";
const BUN = `${process.env.HOME}/.bun/bin/bun`;

let proc: ReturnType<typeof spawn> | null = null;
let dataDir = "";
let apiKey = "";
let cookie = "";

const env = () => ({
  ...process.env,
  PORT: String(PORT),
  DATA_DIR: dataDir,
  JWT_SECRET: SECRET,
  API_KEY_SECRET: "test-api-key-secret-0123456789abcdef",
  INITIAL_PASSWORD: PASSWORD,
  STYX_TEST_MODE: "1",
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

const call = (path: string, init: RequestInit = {}) => fetch(`${BASE}${path}`, { redirect: "manual", ...init });
const asSession = (init: RequestInit = {}): RequestInit => ({
  ...init,
  headers: { ...(init.headers as Record<string, string>), cookie },
});
const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "styx-auth-"));
  const made = spawnSync(
    BUN,
    ["-e", "const { createApiKey } = await import('./src/lib/db/apiKeys.ts'); console.log((await createApiKey('auth-test', 'test-machine')).key)"],
    { cwd: ROOT, env: env(), encoding: "utf8" }
  );
  apiKey = (made.stdout || "").trim().split("\n").pop() || "";
  proc = spawn(BUN, ["server/styx.ts"], { cwd: ROOT, env: env(), stdout: "ignore", stderr: "ignore" });
  await waitReady();
  const login = await call("/api/auth/login", json({ password: PASSWORD }));
  cookie = (login.headers.get("set-cookie") || "").split(";")[0];
});

afterAll(() => {
  proc?.kill("SIGKILL");
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

describe("management API needs a session", () => {
  const closed: [string, string][] = [
    ["GET", "/api/providers"],
    ["GET", "/api/settings"],
    ["GET", "/api/keys"],
    ["GET", "/api/routing/combos"],
    ["GET", "/api/activity"],
    ["GET", "/api/usage/analytics"],
    ["POST", "/api/oauth/glm/init"],
    ["GET", "/api/oauth/glm/poll?state=x"],
    ["POST", "/api/admin/migrate-from-styx"],
    ["PATCH", "/api/model-metadata/x"],
  ];
  for (const [method, path] of closed) {
    test(`${method} ${path} is 401 without a session`, async () => {
      expect((await call(path, { method })).status).toBe(401);
    });
  }

  test("health stays public", async () => {
    expect((await call("/api/health")).status).toBe(200);
    expect((await call("/api/health/ping")).status).toBe(200);
  });

  test("status is false without a cookie", async () => {
    expect(await (await call("/api/auth/status")).json()).toEqual({ authenticated: false });
  });
});

describe("login", () => {
  test("wrong password is 401 and sets no cookie", async () => {
    const r = await call("/api/auth/login", json({ password: "nope" }));
    expect(r.status).toBe(401);
    expect(r.headers.get("set-cookie")).toBeNull();
  });

  test("missing password is 400", async () => {
    expect((await call("/api/auth/login", json({}))).status).toBe(400);
  });

  test("right password sets an HttpOnly session cookie", async () => {
    const r = await call("/api/auth/login", json({ password: PASSWORD }));
    expect(r.status).toBe(200);
    const set = r.headers.get("set-cookie") || "";
    expect(set).toMatch(/^auth_token=/);
    expect(set).toMatch(/HttpOnly/i);
    expect(set).toMatch(/SameSite=Lax/i);
  });

  test("session opens the management API and status", async () => {
    expect((await call("/api/providers", asSession())).status).toBe(200);
    expect(await (await call("/api/auth/status", asSession())).json()).toEqual({ authenticated: true });
  });

  test("a cookie signed with another secret is refused", async () => {
    const forged = await new SignJWT({ authenticated: true })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode("some-other-secret-some-other-secret-1234"));
    expect((await call("/api/providers", { headers: { cookie: `auth_token=${forged}` } })).status).toBe(401);
  });

  test("logout drops the cookie", async () => {
    const r = await call("/api/auth/logout", { method: "POST" });
    expect(r.status).toBe(200);
    expect(r.headers.get("set-cookie") || "").toMatch(/auth_token=;|Max-Age=0|Expires=/i);
  });
});

describe("settings", () => {
  test("never return the password hash", async () => {
    const body = await (await call("/api/settings", asSession())).json();
    expect(Object.keys(body)).not.toContain("password");
    expect(JSON.stringify(body)).not.toMatch(/\$2[aby]\$/);
  });
});

describe("CSRF", () => {
  test("a cookie-authenticated write from a foreign Origin is 403", async () => {
    const r = await call("/api/oauth/glm/init", asSession({ method: "POST", headers: { origin: "https://evil.example" } }));
    expect(r.status).toBe(403);
  });

  test("the same write from the same origin is not blocked", async () => {
    const r = await call("/api/oauth/definitely-not-real/init", asSession({ method: "POST", headers: { origin: BASE } }));
    expect(r.status).toBe(404);
  });
});

describe("/v1 needs an API key", () => {
  test("chat without a key is 401", async () => {
    const r = await call("/v1/chat/completions", json({ model: "x/y", messages: [{ role: "user", content: "hi" }] }));
    expect(r.status).toBe(401);
  });

  test("chat with a bogus key is 401", async () => {
    const r = await call("/v1/chat/completions", {
      ...json({ model: "x/y", messages: [{ role: "user", content: "hi" }] }),
      headers: { "content-type": "application/json", authorization: "Bearer sk-bogus-0000000000000000" },
    });
    expect(r.status).toBe(401);
  });

  test("models without a key is 401", async () => {
    expect((await call("/v1/models")).status).toBe(401);
  });

  test("models with a valid key is 200", async () => {
    expect(apiKey.length).toBeGreaterThan(10);
    expect((await call("/v1/models", { headers: { authorization: `Bearer ${apiKey}` } })).status).toBe(200);
  });

  test("a session may read models (panel) but not run chat", async () => {
    expect((await call("/v1/models", asSession())).status).toBe(200);
    const r = await call("/v1/chat/completions", asSession(json({ model: "x/y", messages: [] })));
    expect(r.status).toBe(401);
  });
});

// The panel is a single-page app: a deep link or a refresh on /panel/keys must serve index.html, while a
// missing asset must stay a 404 (never an HTML page pretending to be a script).
const panelBuilt = existsSync(join(ROOT, "panel", "index.html"));
describe.skipIf(!panelBuilt)("panel routes", () => {
  test("deep links serve the app shell without a session", async () => {
    for (const path of ["/panel/", "/panel/login", "/panel/keys", "/panel/providers"]) {
      const r = await call(path);
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type") ?? "").toMatch(/text\/html/);
      expect(await r.text()).toContain('id="root"');
    }
  });

  test("a missing asset is a 404, not the app shell", async () => {
    expect((await call("/panel/assets/definitely-missing.js")).status).toBe(404);
  });
});

describe("fails closed without a secret", () => {
  test("login is refused when JWT_SECRET is unset", async () => {
    const port = PORT + 1;
    const p = spawn(BUN, ["server/styx.ts"], {
      cwd: ROOT,
      env: { ...env(), PORT: String(port), JWT_SECRET: "" },
      stdout: "ignore",
      stderr: "ignore",
    });
    try {
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        try {
          if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break;
        } catch {}
        await new Promise((r) => setTimeout(r, 500));
      }
      const login = await fetch(`http://127.0.0.1:${port}/api/auth/login`, json({ password: PASSWORD }));
      expect(login.status).toBe(503);
      expect((await fetch(`http://127.0.0.1:${port}/api/providers`)).status).toBe(401);
    } finally {
      p.kill("SIGKILL");
    }
  });
});

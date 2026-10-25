/**
 * OAuth account onboarding endpoints (/api/oauth/...) are served by the Hono host, behind the management session.
 * Boots a REAL server on a throwaway DATA_DIR; nothing here talks to a vendor (authorize only builds a URL).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const PORT = 21197;
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = "oauth-surface-password";
const BUN = `${process.env.HOME}/.bun/bin/bun`;

let proc: ReturnType<typeof spawn> | null = null;
let dataDir = "";
let cookie = "";

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

const call = (method: string, path: string, body?: unknown, session = true) =>
  fetch(`${BASE}${path}`, {
    method,
    headers: { ...(session ? { cookie } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "styx-oauth-"));
  proc = spawn(BUN, ["server/styx.ts"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      DATA_DIR: dataDir,
      STYX_TEST_MODE: "1",
      JWT_SECRET: "oauth-surface-jwt-secret-0123456789abcdef01",
      API_KEY_SECRET: "oauth-surface-api-key-secret-0123456789ab",
      INITIAL_PASSWORD: PASSWORD,
    },
    stdout: "ignore",
    stderr: "ignore",
  });
  await waitReady();
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: PASSWORD }),
  });
  cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
});

afterAll(() => {
  proc?.kill("SIGKILL");
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

describe("/api/oauth", () => {
  test("needs the management session", async () => {
    expect((await call("GET", "/api/oauth/codex/authorize", undefined, false)).status).toBe(401);
    expect((await call("POST", "/api/oauth/codex/exchange", {}, false)).status).toBe(401);
  });

  test("authorize builds a vendor URL and the PKCE material for a provider that uses it", async () => {
    const r = await call("GET", "/api/oauth/codex/authorize?redirect_uri=http://localhost:1455/auth/callback");
    expect(r.status).toBe(200);
    const j: any = await r.json();
    expect(String(j.authUrl)).toMatch(/^https:\/\//);
    expect(j.state || j.codeVerifier).toBeTruthy();
  });

  test("lists the OAuth providers with a readable name and the kind of flow each needs", async () => {
    const r = await call("GET", "/api/oauth/providers");
    expect(r.status).toBe(200);
    const list: any[] = ((await r.json()) as any).providers;
    const flows = new Set(["authorization_code", "authorization_code_pkce", "device_code", "import_token"]);
    expect(list.length).toBeGreaterThan(10);
    expect(list.every((p) => flows.has(p.flowType) && p.name)).toBe(true);
    expect(list.find((p) => p.id === "codex")?.name).toBe("OpenAI Codex");
    // ids match the provider registry (kebab-case), so the panel can pair them with its provider cards
    expect(list.every((p) => p.id === p.id.toLowerCase())).toBe(true);
    expect(list.some((p) => p.id === "codebuddy-intl")).toBe(true);
    // providers served by the older device-flow endpoints (zai -> glm mapping, ZCode secrets kept server-side) say so
    // a provider whose OAuth client only accepts one registered loopback address must be sent exactly that address
    expect(list.find((p) => p.id === "codex")?.redirectUri).toMatch(/^http:\/\/localhost:1455\//);
    expect(list.find((p) => p.id === "glm")?.legacyDevice).toBe(true);
    expect(list.find((p) => p.id === "codex")?.legacyDevice).toBe(false);
    expect((await call("GET", "/api/oauth/providers", undefined, false)).status).toBe(401);
  });

  test("an unknown provider is a JSON error, not a framework 404", async () => {
    const r = await call("GET", "/api/oauth/no-such-provider/authorize");
    expect(r.headers.get("content-type") ?? "").toMatch(/application\/json/);
    expect(r.status).toBeGreaterThanOrEqual(400);
  });

  test("paste-credentials refuses a bad body with a 400 JSON error", async () => {
    const r = await call("POST", "/api/oauth/codex/paste-credentials", { nonsense: true });
    expect(r.status).toBe(400);
    expect(((await r.json()) as any).error).toBeTruthy();
  });
});

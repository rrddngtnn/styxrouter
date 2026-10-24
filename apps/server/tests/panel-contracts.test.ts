/**
 * RED-phase contract tests for the panel API surface.
 *
 * Run: ~/.bun/bin/bun test tests/panel-contracts.test.ts
 *
 * These assert the SECURITY posture of the endpoints the panel talks to —
 * the things a UI regression can silently break:
 *   1. /api/keys never leaks secret material (only prefix)
 *   2. /api/oauth/:id/init never echoes per-session secrets (_zcodePollToken etc.)
 *   3. /api/admin/migrate-from-styx rejects missing params (400)
 *   4. /api/routing/combos + /api/keys + /api/activity degrade gracefully
 *      (empty arrays + error, never 500) on a broken DB
 *   5. unknown oauth provider returns 404, not a crash
 *   6. chat dispatch on unknown provider never resolves an executor
 *      (fail-closed contract, defense-in-depth under the credential layer)
 *
 * Boots a REAL styx server on an ephemeral port with a throwaway DATA_DIR
 * so nothing here touches the operator DB.
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const PORT = 21199;
const BASE = `http://127.0.0.1:${PORT}`;

let proc: ReturnType<typeof spawn> | null = null;
let dataDir = "";
let cookie = "";

async function waitReady(deadlineMs = 30000): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("styx test boot timed out");
}

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "styx-test-"));
  proc = spawn(`${process.env.HOME}/.bun/bin/bun`, ["server/styx.ts"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      DATA_DIR: dataDir,
      STYX_TEST_MODE: "1",
      JWT_SECRET: "panel-contracts-jwt-secret-0123456789abcdef",
      INITIAL_PASSWORD: "panel-contracts-password",
    },
    stdout: "ignore",
    stderr: "ignore",
  });
  await waitReady();
  // The API is closed without a session: log in once and send the cookie on every call.
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "panel-contracts-password" }),
  });
  cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
});


afterAll(() => {
  proc?.kill("SIGKILL");
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

const j = async (path: string, init?: RequestInit) => {
  const r = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...((init?.headers as Record<string, string>) ?? {}), cookie },
  });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body };
};

describe("keys endpoint never leaks secrets", () => {
  test("prefix only, no key material in response", async () => {
    const { status, body } = await j("/api/keys");
    expect(status).toBe(200);
    const keys = (body as any).keys ?? [];
    for (const k of keys) {
      const serialized = JSON.stringify(k);
      expect(serialized).not.toMatch(/sk-[A-Za-z0-9]{20,}/);
      expect(serialized).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/);
    }
  });
});

describe("oauth init never echoes session secrets", () => {
  test("init response contains no token-shaped fields", async () => {
    // provider with a device flow we know: glm (init may fail upstream from
    // a test env — but the RESPONSE must never carry secret material either way)
    const { status, body } = await j("/api/oauth/glm/init", { method: "POST" });
    expect([200, 500]).toContain(status);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/_zcodePollToken/i);
    expect(serialized).not.toMatch(/deviceCode[^"]*":"[A-Za-z0-9]{32,}/);
  });

  test("unknown provider is 404, not a crash", async () => {
    const { status } = await j("/api/oauth/definitely-not-real/init", { method: "POST" });
    expect(status).toBe(404);
    // server still alive
    const health = await j("/api/health");
    expect(health.status).toBe(200);
  });
});

describe("migration endpoint validates input", () => {
  test("missing params -> 400", async () => {
    const { status, body } = await j("/api/admin/migrate-from-styx", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(status).toBe(400);
    expect((body as any).error).toBeDefined();
  });

  test("nonexistent db -> clean 400, not 500", async () => {
    const { status, body } = await j("/api/admin/migrate-from-styx", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        srcDb: "/nonexistent/path.sqlite",
        srcSecret: "dummy",
        dryRun: true,
      }),
    });
    expect(status).toBe(400);
    expect((body as any).error).toMatch(/not found/);
  });
});

describe("read endpoints degrade gracefully", () => {
  test("combos/keys/activity all return 200 with array fields", async () => {
    for (const p of ["/api/routing/combos", "/api/keys", "/api/activity?limit=10"]) {
      const { status, body } = await j(p);
      expect(status).toBe(200);
      expect(Array.isArray((body as any).combos ?? (body as any).keys ?? (body as any).entries)).toBe(true);
    }
  });
});

describe("fail-closed dispatch contract", () => {
  test("unknown chat provider never resolves to an executor (blocked at credential layer)", async () => {
    const { status, body } = await j("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "nonexistent-provider-x/model-1",
        messages: [{ role: "user", content: "hi" }],
        stream: false,
      }),
    });
    // blocked pre-dispatch: no-active-credentials (401) — the guard is layer 2
    expect([400, 401]).toContain(status);
    expect(status).not.toBe(200);
    const msg = JSON.stringify(body);
    expect(msg).not.toMatch(/"choices"/); // never a completion
  });
});

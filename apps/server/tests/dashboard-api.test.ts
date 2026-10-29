import { startTestServer } from "./helpers/start-test-server";
/**
 * Dashboard data endpoints (usage, analytics, quota) are served by the Hono host behind the management session.
 * Boots a REAL server on a throwaway DATA_DIR; an empty install must answer with empty data, not errors.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
let BASE = "";
const PASSWORD = "dashboard-api-password";
const BUN = process.execPath;

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
  dataDir = mkdtempSync(join(tmpdir(), "styx-dash-"));
  ({ proc, base: BASE } = await startTestServer(BUN, {
    cwd: ROOT,
    env: {
      ...process.env,

      DATA_DIR: dataDir,
      STYX_TEST_MODE: "1",
      JWT_SECRET: "dashboard-api-jwt-secret-0123456789abcdef0",
      API_KEY_SECRET: "dashboard-api-api-key-secret-0123456789a",
      INITIAL_PASSWORD: PASSWORD,
    },
  }));
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

describe("dashboard data", () => {
  const paths = [
    "/api/usage/analytics?range=7d",
    "/api/usage/history",
    "/api/usage/call-logs",
    "/api/usage/provider-limits",
    "/api/providers/quota-windows",
  ];

  test("every endpoint needs the management session", async () => {
    for (const p of paths) expect([p, (await call("GET", p, undefined, false)).status]).toEqual([p, 401]);
  });

  test("an empty install answers each one with JSON (not an error and not a framework 404)", async () => {
    for (const p of paths) {
      const r = await call("GET", p);
      expect([p, r.status]).toEqual([p, 200]);
      expect(r.headers.get("content-type") ?? "").toMatch(/application\/json/);
    }
  });

  test("analytics is upstream's full report (summary, daily trend, breakdowns), not just totals", async () => {
    const j: any = await (await call("GET", "/api/usage/analytics?range=7d")).json();
    for (const k of ["summary", "dailyTrend", "byModel", "byProvider", "byAccount", "byApiKey", "errorBreakdown"]) expect(j).toHaveProperty(k);
  });

  test("provider-scoped analytics retains management authentication and returns a report", async () => {
    const path = "/api/usage/analytics?range=all&provider=alpha";
    expect((await call("GET", path, undefined, false)).status).toBe(401);
    const response = await call("GET", path);
    expect(response.status).toBe(200);
    const data: any = await response.json();
    expect(data.summary.totalRequests).toBe(0);
    expect(data.byAccount).toEqual([]);
    expect(data.byApiKey).toEqual([]);
    expect(data.errorBreakdown).toEqual([]);
  });

  test("a route that is not on the allow-list is not served", async () => {
    expect((await call("GET", "/api/context/rtk/filters")).status).toBe(404);
    expect((await call("GET", "/api/compression/engines")).status).toBe(404);
  });
});

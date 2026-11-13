import { startTestServer } from "./helpers/start-test-server";
/**
 * Quota page login column. An OAuth account whose short-lived access token has run out is NOT expired when it holds a
 * refresh token: the token is renewed on first use. Only an account that cannot renew, or that failed its check, is.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFile, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const ROOT = join(import.meta.dir, "..");
let BASE = "";
const PASSWORD = "quota-status-password";
const BUN = process.execPath;

let proc: ReturnType<typeof spawn> | null = null;
let dataDir = "";
let cookie = "";

const env = () => ({
  ...process.env,
  DATA_DIR: dataDir,
  STYX_TEST_MODE: "1",
  JWT_SECRET: "quota-status-jwt-secret-0123456789abcdef01",
  API_KEY_SECRET: "quota-status-api-key-secret-0123456789a",
  INITIAL_PASSWORD: PASSWORD,
});

const seed = `
const { createProviderConnection, updateProviderConnection } = await import("./src/lib/db/providers.ts");
const { setProviderLimitsCache } = await import("./src/lib/db/providerLimits.ts");
const past = new Date(Date.now() - 3 * 3600_000).toISOString();
const future = new Date(Date.now() + 3 * 3600_000).toISOString();
// create ignores tokenExpiresAt, so it is set with an update
const add = async (email, { tokenExpiresAt, ...o }) => {
  const c = await createProviderConnection({ provider: "codex", name: email, email, authType: "oauth", accessToken: "tok-" + email, isActive: 1, ...o });
  await updateProviderConnection(c.id, { tokenExpiresAt });
};
await add("renewable@example.test", { refreshToken: "rt-1", tokenExpiresAt: past, testStatus: "active" });
await add("stuck@example.test", { tokenExpiresAt: past, testStatus: "active" });
await add("failed@example.test", { refreshToken: "rt-3", tokenExpiresAt: past, testStatus: "expired" });
await add("fresh@example.test", { refreshToken: "rt-4", tokenExpiresAt: future, testStatus: "active" });
const { replaceSyncedAvailableModelsForConnection } = await import("./src/lib/db/models.ts");
const ag = await createProviderConnection({ provider: "antigravity", name: "ag@example.test", email: "ag@example.test", authType: "oauth", accessToken: "tok-ag", isActive: 1 });
const cx = await createProviderConnection({ provider: "codex", name: "cx@example.test", email: "cx@example.test", authType: "oauth", accessToken: "tok-cx", isActive: 1 });
const off = await createProviderConnection({ provider: "kiro", name: "kiro-off", authType: "oauth", accessToken: "tok-kiro", isActive: false });
await replaceSyncedAvailableModelsForConnection("antigravity", ag.id, ["low", "medium", "high", "xhigh"].map(t => ({ id: "gemini-4-hydrogen-" + t, name: "Hydrogen" })));
setProviderLimitsCache(ag.id, {
  quotas: {
    "gemini-4-hydrogen-low": { used: 1000, total: 1000, remainingPercentage: 0, fractionReported: false, resetAt: null, unlimited: false },
    "gemini-4-argon-low": { used: 600, total: 1000, remainingPercentage: 40, resetAt: "2026-10-31T08:00:00.000Z", unlimited: false },
    "gemini-4-argon-high": { used: 600, total: 1000, remainingPercentage: 40, resetAt: "2026-10-31T08:00:00.000Z", unlimited: false },
    "claude-sonnet-5-5-high": { used: 750, total: 1000, remainingPercentage: 25, resetAt: "2026-10-26T18:00:00.000Z", unlimited: false },
    "gemini-3.8-flash-high": { used: 0, total: 1000, remainingPercentage: 100, resetAt: "2026-10-25T20:00:00.000Z", unlimited: false },
  },
  plan: "Pro",
  message: null,
  fetchedAt: "2026-10-25T14:30:00.000Z",
  source: "scheduled",
});
setProviderLimitsCache(cx.id, {
  quotas: {
    session: { used: 20, total: 100, remaining: 80, resetAt: "2026-10-25T19:00:00.000Z", unlimited: false },
    weekly: { used: 45, total: 100, remaining: 55, resetAt: "2026-11-01T14:00:00.000Z", unlimited: false },
  },
  plan: "plus",
  message: null,
  fetchedAt: "2026-10-25T14:31:00.000Z",
  source: "scheduled",
});
void off;
`;

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "styx-quota-"));
  try {
    await execFileAsync(BUN, ["-e", seed], { cwd: ROOT, env: env(), timeout: 30000, killSignal: "SIGKILL" });
  } catch (error) {
    throw new Error(`seeding failed: ${String(error)}`, { cause: error });
  }
  ({ proc, base: BASE } = await startTestServer(BUN, { cwd: ROOT, env: env() }));
  // startTestServer waits for the child to bind its own ephemeral port.
  const health = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(10000) });
  if (!health.ok) throw new Error(`Test server health check failed: ${health.status}`);
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: PASSWORD }),
    signal: AbortSignal.timeout(10000),
  });
  if (!login.ok) throw new Error(`Test server login failed: ${login.status}`);
  cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
  if (!cookie) throw new Error("Test server login did not set a cookie");
}, 90000);

afterAll(async () => {
  if (proc && proc.exitCode === null && proc.signalCode === null) {
    const exited = new Promise<void>((resolve) => proc!.once("exit", () => resolve()));
    proc.kill("SIGKILL");
    await exited;
  }
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
}, 10000);

describe("/api/usage/quota tokenStatus", () => {
  test("separates renewable, stuck, failed and fresh accounts", async () => {
    const j: any = await (await fetch(`${BASE}/api/usage/quota`, { headers: { cookie } })).json();
    const status = Object.fromEntries(j.providers.map((p: any) => [p.name, p.tokenStatus]));
    expect(status["renewable@example.test"]).toBe("refreshable");
    expect(status["stuck@example.test"]).toBe("expired");
    expect(status["failed@example.test"]).toBe("expired");
    expect(status["fresh@example.test"]).toBe("valid");
  });

  test("returns cached multi-window breakdown, Codex derived percentages, and Antigravity family grouping", async () => {
    const j: any = await (await fetch(`${BASE}/api/usage/quota`, { headers: { cookie } })).json();
    const byName = Object.fromEntries(j.providers.map((p: any) => [p.name, p]));

    const agRow = byName["ag@example.test"];
    expect(agRow.plan).toBe("Pro");
    expect(agRow.windows.map((w: any) => w.label)).toEqual([
      "Gemini 4 Argon",
      "Claude / GPT-OSS",
      "Gemini 3 Flash",
      "gemini-4-hydrogen-low",
    ]);
    expect(agRow.windows[0].models).toEqual(["gemini-4-argon-low", "gemini-4-argon-high"]);
    expect(agRow.percentRemaining).toBe(25);

    const cxRow = byName["cx@example.test"];
    expect(cxRow.plan).toBe("plus");
    expect(cxRow.windows.map((w: any) => [w.label, w.percentRemaining])).toEqual([
      ["5h Session", 80],
      ["Weekly", 55],
    ]);
    expect(cxRow.percentRemaining).toBe(55);

    expect(byName["kiro-off"]?.isActive).toBe(false);
  });
});

 test("cached Hydrogen unknown stays unknown; absent telemetry is listed without inventing pools", async () => {
  const j: any = await (await fetch(`${BASE}/api/usage/quota`, { headers: { cookie } })).json();
  const ag = j.providers.find((p: any) => p.name === "ag@example.test");
  const h = ag.windows.find((w: any) => w.models.includes("gemini-4-hydrogen-low"));
  expect(h).toMatchObject({ percentRemaining: null, used: null, total: null, remaining: null, unlimited: false });
  expect(ag.unreportedQuotaModels).toEqual(["gemini-4-hydrogen-medium", "gemini-4-hydrogen-high", "gemini-4-hydrogen-xhigh"]);
  expect(j.providers.find((p: any) => p.name === "cx@example.test").unreportedQuotaModels).toBeUndefined();
});

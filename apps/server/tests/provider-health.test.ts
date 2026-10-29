import { startTestServer } from "./helpers/start-test-server";
/**
 * Provider cards: "healthy" means at least one account of that provider passed its last check, "enabled" means it has
 * accounts at all. Boots a REAL server on a throwaway DATA_DIR with accounts inserted straight into the database.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
let BASE = "";
const PASSWORD = "provider-health-password";
const BUN = process.execPath;

let proc: ReturnType<typeof spawn> | null = null;
let dataDir = "";
let cookie = "";

const env = () => ({
  ...process.env,

  DATA_DIR: dataDir,
  STYX_TEST_MODE: "1",
  JWT_SECRET: "provider-health-jwt-secret-0123456789abcdef0",
  API_KEY_SECRET: "provider-health-api-key-secret-0123456789",
  INITIAL_PASSWORD: PASSWORD,
});

const seed = `
const { createProviderConnection } = await import("./src/lib/db/providers.ts");
// OAuth accounts are told apart by email, so a provider can hold a mix; API-key accounts of one provider merge.
const oauth = (email, testStatus) =>
  createProviderConnection({ provider: "codex", name: email, email, authType: "oauth", accessToken: "tok-" + email, testStatus, isActive: 1 });
await oauth("a@example.test", "active");
await oauth("b@example.test", "expired");
await createProviderConnection({ provider: "anthropic", name: "k", authType: "apikey", apiKey: "sk-test-0123456789abcdef", testStatus: "expired", isActive: 1 });
`;

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "styx-prov-"));
  const made = spawnSync(BUN, ["-e", seed], { cwd: ROOT, env: env(), encoding: "utf8" });
  if (made.status !== 0) throw new Error("seeding failed: " + (made.stderr || made.stdout).slice(0, 300));
  ({ proc, base: BASE } = await startTestServer(BUN, { cwd: ROOT, env: env() }));
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
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

describe("/api/providers health", () => {
  const get = async () => {
    const j: any = await (await fetch(`${BASE}/api/providers`, { headers: { cookie } })).json();
    return new Map<string, any>(j.providers.map((p: any) => [p.id, p]));
  };

  test("a provider with a passing account is healthy, and reports how many accounts pass", async () => {
    expect((await get()).get("codex")).toMatchObject({ enabled: true, healthy: true, accounts: 2, activeAccounts: 1 });
  });

  test("a provider whose accounts all failed is enabled but not healthy", async () => {
    expect((await get()).get("anthropic")).toMatchObject({ enabled: true, healthy: false, accounts: 1, activeAccounts: 0 });
  });

  test("a provider with no accounts is neither", async () => {
    expect((await get()).get("gemini")).toMatchObject({ enabled: false, healthy: false, accounts: 0, activeAccounts: 0 });
  });
});

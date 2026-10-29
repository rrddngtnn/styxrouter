import { expect, test } from "bun:test";
import { startTestServer } from "./helpers/start-test-server";
import { stopTestProcess } from "./helpers/stop-test-process";

test("disabled token scheduler exposes honest protected health without credential data", async () => {
  const server = await startTestServer(process.execPath, { cwd: join(import.meta.dir, ".."), env: { ...process.env, STYX_TEST_MODE: "1", JWT_SECRET: "fixture-jwt-secret-01234567890123456789", INITIAL_PASSWORD: "fixture-password" } });
  try {
    const url = server.base + "/api/process-health/token-scheduler";
    expect((await fetch(url)).status).toBe(401);
    const login = await fetch(server.base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "fixture-password" }) });
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const response = await fetch(url, { headers: { cookie } });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ enabled: false, running: false, lastStartedAt: null, lastFinishedAt: null, lastOutcome: null, lastDueCount: null, lastRefreshedCount: null, nextScheduledAt: null });
  } finally { await stopTestProcess(server.proc); }
}, 60000);

import { join } from "node:path";

test("enabled scheduler reports its next tick without claiming a pass has run", async () => {
  const server = await startTestServer(process.execPath, { cwd: join(import.meta.dir, ".."), env: { ...process.env, STYX_TEST_MODE: "0", STYX_DISABLE_TOKEN_HEALTHCHECK: "0", BUN_TEST: "", JWT_SECRET: "fixture-jwt-secret-01234567890123456789", INITIAL_PASSWORD: "fixture-password" } });
  try {
    const login = await fetch(server.base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "fixture-password" }) });
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const response = await fetch(server.base + "/api/process-health/token-scheduler", { headers: { cookie } });
    const body = await response.json();
    expect(body.enabled).toBe(true);
    expect(body.running).toBe(false);
    expect(body.lastStartedAt).toBeNull();
    expect(body.nextScheduledAt).toBeGreaterThan(Date.now());
    await new Promise((resolve) => setTimeout(resolve, 31_000));
    const after = await (await fetch(server.base + "/api/process-health/token-scheduler", { headers: { cookie } })).json();
    expect(after.lastStartedAt).toBeGreaterThan(0);
    expect(after.lastFinishedAt).toBeGreaterThanOrEqual(after.lastStartedAt);
    expect(after.lastOutcome).toBe("completed");
    expect(after.lastDueCount).toBe(0);
    expect(after.lastRefreshedCount).toBe(0);
    expect(after.nextScheduledAt).toBeGreaterThan(Date.now());
  } finally { await stopTestProcess(server.proc); }
}, 60000);

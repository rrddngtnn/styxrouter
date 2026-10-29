import { expect, test } from "bun:test";
import { join } from "node:path";
import { startTestServer } from "./helpers/start-test-server";
import { stopTestProcess } from "./helpers/stop-test-process";

test("token scheduler route is session-only and initializes independently in another process", async () => {
  const options = { cwd: join(import.meta.dir, ".."), env: { ...process.env, STYX_TEST_MODE: "1", JWT_SECRET: "fixture-jwt-secret-01234567890123456789", INITIAL_PASSWORD: "fixture-password" } };
  const first = await startTestServer(process.execPath, options);
  let second: Awaited<ReturnType<typeof startTestServer>> | undefined;
  try {
    const login = await fetch(first.base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "fixture-password" }) });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    for (const headers of [{}, { authorization: "Bearer fixture-key" }, { cookie: "auth_token=invalid" }]) {
      expect((await fetch(first.base + "/api/process-health/token-scheduler", { headers })).status).toBe(401);
    }
    const firstResponse = await fetch(first.base + "/api/process-health/token-scheduler", { headers: { cookie } });
    expect(firstResponse.status).toBe(200);
    expect(firstResponse.headers.get("cache-control")).toBe("no-store");
    const state = await firstResponse.json();
    expect(state).toEqual({ enabled: false, running: false, lastStartedAt: null, lastFinishedAt: null, lastOutcome: null, lastDueCount: null, lastRefreshedCount: null, nextScheduledAt: null });
    second = await startTestServer(process.execPath, options);
    const secondLogin = await fetch(second.base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "fixture-password" }) });
    const secondCookie = secondLogin.headers.get("set-cookie")!.split(";")[0]!;
    const secondResponse = await fetch(second.base + "/api/process-health/token-scheduler", { headers: { cookie: secondCookie } });
    expect(secondResponse.status).toBe(200);
    expect(secondResponse.headers.get("cache-control")).toBe("no-store");
    expect(await secondResponse.json()).toEqual(state);
  } finally {
    if (second) await stopTestProcess(second.proc);
    await stopTestProcess(first.proc);
  }
}, 60000);

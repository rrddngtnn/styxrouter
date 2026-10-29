import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startTestServer } from "./helpers/start-test-server";
import { stopTestProcess } from "./helpers/stop-test-process";

test("process health subroutes expose only uncached process-local metrics over the real HTTP host", async () => {
  const dir = mkdtempSync(join(tmpdir(), "health-subroutes-"));
  let proc: Awaited<ReturnType<typeof startTestServer>>["proc"] | undefined;
  try {
    const server = await startTestServer(process.execPath, {
      cwd: join(import.meta.dir, ".."),
      env: { ...process.env, DATA_DIR: dir, STYX_TEST_MODE: "1", JWT_SECRET: "fixture-jwt-secret-01234567890123456789", INITIAL_PASSWORD: "fixture-password", HEALTH_FIXTURE_SECRET: "health-secret-do-not-expose" },
    });
    proc = server.proc;
    const routes = ["cpu", "peak", "swap", "start"];
    for (const route of routes) {
      for (const headers of [{}, { cookie: "auth_token=invalid" }, { authorization: "Bearer invalid" }]) {
        expect((await fetch(`${server.base}/api/process-health/${route}`, { headers })).status).toBe(401);
      }
    }
    const login = await fetch(server.base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "fixture-password" }) });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const get = async (route: string) => {
      const response = await fetch(`${server.base}/api/process-health/${route}`, { headers: { cookie } });
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const text = await response.text();
      expect(text).not.toContain("health-secret-do-not-expose");
      expect(text).not.toContain(dir);
      expect(text).not.toContain(cookie);
      return JSON.parse(text);
    };
    const start = await get("start");
    expect(Object.keys(start)).toEqual(["startedAt"]);
    expect(Number.isFinite(Date.parse(start.startedAt))).toBe(true);
    expect(Date.parse(start.startedAt)).toBeLessThanOrEqual(Date.now());
    expect(await get("start")).toEqual(start);
    const cpu1 = await get("cpu");
    const cpu2 = await get("cpu");
    expect(Object.keys(cpu1).sort()).toEqual(["systemMicroseconds", "userMicroseconds"]);
    for (const key of ["systemMicroseconds", "userMicroseconds"]) {
      expect(Number.isSafeInteger(cpu1[key])).toBe(true);
      expect(cpu1[key]).toBeGreaterThanOrEqual(0);
      expect(cpu2[key]).toBeGreaterThanOrEqual(cpu1[key]);
    }
    const peak = await get("peak");
    const swap = await get("swap");
    expect(Object.keys(peak)).toEqual(["peakRssBytes"]);
    expect(Object.keys(swap)).toEqual(["swapBytes"]);
    if (process.platform === "linux") {
      const status = readFileSync(`/proc/${proc.pid}/status`, "utf8");
      const peakKiB = Number(status.match(/^VmHWM:\s+(\d+)\s+kB$/m)![1]);
      const swapKiB = Number(status.match(/^VmSwap:\s+(\d+)\s+kB$/m)![1]);
      expect(peak.peakRssBytes).toBeGreaterThan(0);
      expect(peak.peakRssBytes).toBeLessThanOrEqual(peakKiB * 1024);
      expect(peak.peakRssBytes).toBeGreaterThan(peakKiB * 1024 * 0.75);
      expect(swap.swapBytes).toBe(swapKiB * 1024);
    } else {
      expect(peak.peakRssBytes).toBeNull();
      expect(swap.swapBytes).toBeNull();
    }
  } finally {
    if (proc) await stopTestProcess(proc);
    rmSync(dir, { recursive: true, force: true });
  }
}, 60000);

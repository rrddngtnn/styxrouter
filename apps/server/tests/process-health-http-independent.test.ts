import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startTestServer } from "./helpers/start-test-server";
import { stopTestProcess } from "./helpers/stop-test-process";

test("process health on the actual HTTP host is session protected, uncached, and process-local", async () => {
  const dir = mkdtempSync(join(tmpdir(), "process-health-review-"));
  const secret = "fixture-process-health-secret-never-expose";
  let proc: Awaited<ReturnType<typeof startTestServer>>["proc"] | undefined;
  try {
    const server = await startTestServer(process.execPath, { cwd: join(import.meta.dir, ".."), env: { ...process.env, DATA_DIR: dir, STYX_TEST_MODE: "1", JWT_SECRET: "fixture-jwt-secret-01234567890123456789", INITIAL_PASSWORD: "fixture-password", PROCESS_HEALTH_REVIEW_SECRET: secret } });
    proc = server.proc;
    const url = server.base + "/api/process-health";
    for (const headers of [{}, { authorization: "Bearer fixture-api-key" }, { cookie: "auth_token=invalid" }]) {
      const response = await fetch(url, { headers });
      expect(response.status).toBe(401);
      expect(await response.text()).not.toContain(secret);
    }
    const login = await fetch(server.base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "fixture-password" }) });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const response = await fetch(url, { headers: { cookie } });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const text = await response.text();
    expect(text).not.toContain(secret);
    expect(text).not.toContain(cookie);
    const body = JSON.parse(text);
    expect(Object.keys(body).sort()).toEqual(["memory", "uptimeSeconds"]);
    expect(Object.keys(body.memory).sort()).toEqual(["heapTotalBytes", "heapUsedBytes", "rssBytes"]);
    expect(body.uptimeSeconds).toBeGreaterThan(0);
    expect(body.memory.heapUsedBytes).toBeGreaterThan(0);
    expect(body.memory.heapTotalBytes).toBeGreaterThan(0);
    const status = readFileSync(`/proc/${proc.pid}/status`, "utf8");
    const rss = Number(status.match(/^VmRSS:\s+(\d+) kB$/m)![1]) * 1024;
    expect(body.memory.rssBytes).toBeGreaterThan(rss * 0.75);
    expect(body.memory.rssBytes).toBeLessThan(rss * 1.25);
    // The test process predates the child server; the measured uptime must not be the caller's.
    expect(body.uptimeSeconds).toBeLessThan(process.uptime() + 1);
  } finally {
    if (proc) await stopTestProcess(proc);
    rmSync(dir, { recursive: true, force: true });
  }
}, 60000);

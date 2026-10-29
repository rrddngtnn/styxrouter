import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startTestServer } from "./helpers/start-test-server";
import { stopTestProcess } from "./helpers/stop-test-process";

test("thread health is authenticated on the real host and reports its own process", async () => {
  const dir = mkdtempSync(join(tmpdir(), "thread-health-"));
  let proc: Awaited<ReturnType<typeof startTestServer>>["proc"] | undefined;
  try {
    const server = await startTestServer(process.execPath, {
      cwd: join(import.meta.dir, ".."),
      env: { ...process.env, DATA_DIR: dir, STYX_TEST_MODE: "1", JWT_SECRET: "fixture-jwt-secret-01234567890123456789", INITIAL_PASSWORD: "fixture-password" },
    });
    proc = server.proc;
    const url = server.base + "/api/process-health/threads";
    expect((await fetch(url)).status).toBe(401);
    const login = await fetch(server.base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "fixture-password" }) });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const response = await fetch(url, { headers: { cookie } });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json() as { threadCount: number | null };
    expect(Object.keys(body)).toEqual(["threadCount"]);
    if (process.platform === "linux") {
      const expected = Number(readFileSync(`/proc/${proc.pid}/status`, "utf8").match(/^Threads:\s+(\d+)\s*$/m)![1]);
      expect(body.threadCount).toBe(expected);
    } else expect(body.threadCount).toBeNull();
  } finally {
    if (proc) await stopTestProcess(proc);
    rmSync(dir, { recursive: true, force: true });
  }
}, 60000);

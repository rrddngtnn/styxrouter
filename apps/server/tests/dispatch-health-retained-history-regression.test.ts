import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startTestServer } from "./helpers/start-test-server";
import { stopTestProcess } from "./helpers/stop-test-process";

test("dispatch health retains old-only providers and excludes future observations", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dispatch-history-"));
  let proc: Awaited<ReturnType<typeof startTestServer>>["proc"] | undefined;
  try {
    const server = await startTestServer(process.execPath, { cwd: dir, env: { ...process.env, DATA_DIR: dir, STYX_TEST_MODE: "1", JWT_SECRET: "fixture-jwt-secret-01234567890123456789", INITIAL_PASSWORD: "fixture-password" } });
    proc = server.proc;
    const login = await fetch(server.base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "fixture-password" }) });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const db = new Database(join(dir, "storage.sqlite"));
    try {
      const insert = db.prepare("INSERT INTO usage_history (provider, timestamp, success) VALUES (?, ?, ?)");
      const old = new Date(Date.now() - 48 * 3600000).toISOString();
      insert.run("old-only", old, 0);
      insert.run("future-only", new Date(Date.now() + 3600000).toISOString(), 1);
      const response = await fetch(server.base + "/api/process-health/dispatch", { headers: { cookie } });
      expect(response.status).toBe(200);
      const body = await response.json() as any;
      expect(body.providers).toEqual([{ provider: "old-only", lastSuccessAt: null, lastFailureAt: old, hour: { requests: 0, failures: 0 }, day: { requests: 0, failures: 0 } }]);
    } finally { db.close(); }
  } finally {
    if (proc) await stopTestProcess(proc);
    rmSync(dir, { recursive: true, force: true });
  }
}, 60000);

import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startTestServer } from "./helpers/start-test-server";
import { stopTestProcess } from "./helpers/stop-test-process";

test("authenticated provider dispatch health reports retained 1h and 24h outcomes without request details", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dispatch-health-"));
  let proc: Awaited<ReturnType<typeof startTestServer>>["proc"] | undefined;
  try {
    const server = await startTestServer(process.execPath, { cwd: dir, env: { ...process.env, DATA_DIR: dir, STYX_TEST_MODE: "1", JWT_SECRET: "fixture-jwt-secret-01234567890123456789", INITIAL_PASSWORD: "fixture-password" } });
    proc = server.proc;
    const endpoint = server.base + "/api/process-health/dispatch";
    expect((await fetch(endpoint)).status).toBe(401);
    const login = await fetch(server.base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "fixture-password" }) });
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const db = new Database(join(dir, "storage.sqlite"));
    try {
      const insert = db.prepare("INSERT INTO usage_history (provider, timestamp, success, model, error_code) VALUES (?, ?, ?, ?, ?)");
      const time = (hours: number) => new Date(Date.now() - hours * 3600000).toISOString();
      const recent = time(0.1), failed = time(0.2), older = time(2);
      insert.run("alpha", recent, 1, "secret-model", "secret-error");
      insert.run("alpha", failed, 0, "secret-model", "secret-error");
      insert.run("alpha", older, 0, "secret-model", "secret-error");
      insert.run("alpha", time(25), 0, "secret-model", "secret-error");
      insert.run("beta", recent, 1, "secret-model", "secret-error");
      const response = await fetch(endpoint, { headers: { cookie } });
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const text = await response.text();
      expect(text).not.toContain("secret-");
      expect(text).not.toContain(dir);
      const data = JSON.parse(text);
      expect(data.source).toBe("retained_usage_history");
      expect(data.providers).toEqual([
        { provider: "alpha", lastSuccessAt: recent, lastFailureAt: failed, hour: { requests: 2, failures: 1 }, day: { requests: 3, failures: 2 } },
        { provider: "beta", lastSuccessAt: recent, lastFailureAt: null, hour: { requests: 1, failures: 0 }, day: { requests: 1, failures: 0 } },
      ]);
    } finally { db.close(); }
  } finally {
    if (proc) await stopTestProcess(proc);
    rmSync(dir, { recursive: true, force: true });
  }
}, 60000);

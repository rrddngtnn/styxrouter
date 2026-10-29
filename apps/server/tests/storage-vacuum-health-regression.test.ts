import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startTestServer } from "./helpers/start-test-server";
import { stopTestProcess } from "./helpers/stop-test-process";

test("actual storage health route exposes only the last successful scheduler vacuum timestamp", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vacuum-health-"));
  let proc: Awaited<ReturnType<typeof startTestServer>>["proc"] | undefined;
  try {
    const server = await startTestServer(process.execPath, { cwd: join(import.meta.dir, ".."), env: { ...process.env, DATA_DIR: dir, STYX_TEST_MODE: "1", JWT_SECRET: "fixture-jwt-secret-01234567890123456789", INITIAL_PASSWORD: "fixture-password" } });
    proc = server.proc;
    const endpoint = server.base + "/api/storage-health/vacuum";
    for (const headers of [{}, { cookie: "auth_token=invalid" }, { authorization: "Bearer invalid" }]) expect((await fetch(endpoint, { headers })).status).toBe(401);
    const login = await fetch(server.base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "fixture-password" }) });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const db = new Database(join(dir, "storage.sqlite"));
    try {
      const set = db.prepare("INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES ('scheduler', 'vacuum', ?)");
      const get = async () => {
        const response = await fetch(endpoint, { headers: { cookie } });
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        const text = await response.text();
        expect(text).not.toContain(dir);
        expect(text).not.toContain("secret-fixture");
        return JSON.parse(text);
      };
      set.run(JSON.stringify({ lastRunAt: 123456789, lastError: "secret-fixture", isRunning: false }));
      expect(await get()).toEqual({ lastSuccessfulSchedulerVacuumAt: 123456789 });
      for (const value of ['not-json', JSON.stringify({ lastRunAt: -1 }), JSON.stringify({ lastRunAt: "123" }), JSON.stringify({ lastRunAt: null })]) {
        set.run(value);
        expect(await get()).toEqual({ lastSuccessfulSchedulerVacuumAt: null });
      }
    } finally { db.close(); }
  } finally {
    if (proc) await stopTestProcess(proc);
    rmSync(dir, { recursive: true, force: true });
  }
}, 60000);

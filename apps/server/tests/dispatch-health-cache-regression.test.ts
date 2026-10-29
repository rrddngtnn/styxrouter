import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startTestServer } from "./helpers/start-test-server";
import { stopTestProcess } from "./helpers/stop-test-process";

test("dispatch snapshot reuses unchanged history and refreshes after external writes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dispatch-cache-"));
  let proc: Awaited<ReturnType<typeof startTestServer>>["proc"] | undefined;
  try {
    const server = await startTestServer(process.execPath, { cwd: dir, env: { ...process.env, DATA_DIR: dir, STYX_TEST_MODE: "1", JWT_SECRET: "fixture-jwt-secret-01234567890123456789", INITIAL_PASSWORD: "fixture-password" } });
    proc = server.proc;
    const login = await fetch(server.base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "fixture-password" }) });
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const db = new Database(join(dir, "storage.sqlite"));
    try {
      const insert = db.prepare("INSERT INTO usage_history (provider, timestamp, success) VALUES (?, ?, ?)");
      const now = Date.now();
      const offset = new Date(now - 60000 - 10 * 3600000).toISOString().replace("Z", "-10:00");
      db.transaction(() => { for (let i = 0; i < 200000; i++) insert.run("bulk", offset, i % 2); })();
      const read = async () => { const start = performance.now(); const response = await fetch(server.base + "/api/process-health/dispatch", { headers: { cookie } }); expect(response.status).toBe(200); return { body: await response.json() as any, ms: performance.now() - start }; };
      const cold = await read();
      const warm = await read();
      expect(warm.body.providers).toEqual(cold.body.providers);
      expect(warm.body.providers[0].hour).toEqual({ requests: 200000, failures: 100000 });
      console.log(`dispatch 200k cold=${cold.ms.toFixed(1)}ms warm=${warm.ms.toFixed(1)}ms`);
      expect(warm.ms).toBeLessThan(100);
      expect(warm.body.asOf).toBe(cold.body.asOf);
      await new Promise((resolve) => setTimeout(resolve, 1100));
      const expired = await read();
      expect(Date.parse(expired.body.asOf)).toBeGreaterThan(Date.parse(warm.body.asOf));
      insert.run("external", new Date(now - 2000).toISOString(), 1);
      const changed = await read();
      expect(changed.body.providers.find((p: any) => p.provider === "external")?.hour.requests).toBe(1);
      db.prepare("DELETE FROM usage_history WHERE provider = ?").run("external");
      const deleted = await read();
      expect(deleted.body.providers.some((p: any) => p.provider === "external")).toBe(false);
    } finally { db.close(); }
  } finally { if (proc) await stopTestProcess(proc); rmSync(dir, { recursive: true, force: true }); }
}, 60000);

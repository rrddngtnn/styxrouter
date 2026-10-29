import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startTestServer } from "./helpers/start-test-server";
import { stopTestProcess } from "./helpers/stop-test-process";

// Offset notation deliberately changes lexical ordering without changing the instant.
function offset(ms: number, minutes: number): string {
  return new Date(ms + minutes * 60000).toISOString().replace("Z", `${minutes < 0 ? "-" : "+"}${String(Math.floor(Math.abs(minutes) / 60)).padStart(2, "0")}:${String(Math.abs(minutes) % 60).padStart(2, "0")}`);
}

test("retained usage uses actual instants for mixed offsets and excludes future records", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dispatch-offset-"));
  let proc: Awaited<ReturnType<typeof startTestServer>>["proc"] | undefined;
  try {
    const server = await startTestServer(process.execPath, { cwd: dir, env: { ...process.env, DATA_DIR: dir, STYX_TEST_MODE: "1", JWT_SECRET: "fixture-jwt-secret-01234567890123456789", INITIAL_PASSWORD: "fixture-password" } });
    proc = server.proc;
    const login = await fetch(server.base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "fixture-password" }) });
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const db = new Database(join(dir, "storage.sqlite"));
    try {
      const now = Date.now();
      const insert = db.prepare("INSERT INTO usage_history (provider, timestamp, success) VALUES (?, ?, ?)");
      insert.run("offset", offset(now - 20 * 60000, -600), 1);
      insert.run("offset", offset(now - 40 * 60000, 600), 1);
      insert.run("offset", offset(now - 2 * 3600000, 600), 0);
      insert.run("offset", offset(now + 3600000, -600), 0);
      insert.run("offset", "invalid", 0);
      const response = await fetch(server.base + "/api/process-health/dispatch", { headers: { cookie } });
      expect(response.status).toBe(200);
      const body = await response.json() as any;
      expect(body.source).toBe("retained_usage_history");
      expect(body.providers).toEqual([{ provider: "offset", lastSuccessAt: new Date(now - 20 * 60000).toISOString(), lastFailureAt: new Date(now - 2 * 3600000).toISOString(), hour: { requests: 2, failures: 0 }, day: { requests: 3, failures: 1 } }]);
      // Synthetic retained history exercises the real endpoint without production data.
      db.transaction(() => {
        for (let i = 0; i < 200_000; i++) insert.run("bulk", offset(now - 120_000 - i, i % 2 ? 600 : -600), i % 2);
      })();
      const start = performance.now();
      const bulkResponse = await fetch(server.base + "/api/process-health/dispatch", { headers: { cookie } });
      const bulkBody = await bulkResponse.json() as any;
      const elapsed = performance.now() - start;
      expect(bulkResponse.status).toBe(200);
      expect(bulkBody.providers.find((p: any) => p.provider === "bulk").hour).toEqual({ requests: 200_000, failures: 100_000 });
      expect(elapsed).toBeLessThan(5000);
      console.log(`200k retained rows: ${elapsed.toFixed(1)}ms`);
    } finally { db.close(); }
  } finally { if (proc) await stopTestProcess(proc); rmSync(dir, { recursive: true, force: true }); }
}, 60000);

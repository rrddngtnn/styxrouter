import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startTestServer } from "./helpers/start-test-server";
import { stopTestProcess } from "./helpers/stop-test-process";

test("dispatch health safely handles retained provider and timestamp data", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dispatch-review-"));
  let proc: Awaited<ReturnType<typeof startTestServer>>["proc"] | undefined;
  try {
    const server = await startTestServer(process.execPath, { cwd: dir, env: { ...process.env, DATA_DIR: dir, STYX_TEST_MODE: "1", JWT_SECRET: "fixture-jwt-secret-01234567890123456789", INITIAL_PASSWORD: "fixture-password" } });
    proc = server.proc;
    const url = server.base + "/api/process-health/dispatch";
    const unauthorized = await fetch(url);
    expect(unauthorized.status).toBe(401);
    const login = await fetch(server.base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "fixture-password" }) });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const db = new Database(join(dir, "storage.sqlite"));
    try {
      const insert = db.prepare("INSERT INTO usage_history (provider, timestamp, success, model, error_code) VALUES (?, ?, ?, ?, ?)");
      const recent = new Date(Date.now() - 60000).toISOString();
      const older = new Date(Date.now() - 25 * 3600000).toISOString();
      insert.run("alpha", recent, 1, "fixture-secret-model", "fixture-secret-error");
      insert.run("alpha", older, 0, "fixture-secret-model", "fixture-secret-error");
      const response = await fetch(url, { headers: { cookie } });
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const body = await response.json() as any;
      expect(JSON.stringify(body)).not.toContain("fixture-secret");
      expect(body.providers[0].day).toEqual({ requests: 1, failures: 0 });
      expect(body.providers[0].lastSuccessAt).toBe(recent);
      expect(body.providers[0].lastFailureAt).toBe(older);
    } finally { db.close(); }
  } finally {
    if (proc) await stopTestProcess(proc);
    rmSync(dir, { recursive: true, force: true });
  }
}, 60000);

test("dispatch health CPU cost under retained history load", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dispatch-cpu-review-"));
  let proc: Awaited<ReturnType<typeof startTestServer>>["proc"] | undefined;
  try {
    const server = await startTestServer(process.execPath, { cwd: dir, env: { ...process.env, DATA_DIR: dir, STYX_TEST_MODE: "1", JWT_SECRET: "fixture-jwt-secret-01234567890123456789", INITIAL_PASSWORD: "fixture-password" } });
    proc = server.proc;
    const login = await fetch(server.base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "fixture-password" }) });
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const db = new Database(join(dir, "storage.sqlite"));
    try {
      const insert = db.prepare("INSERT INTO usage_history (provider, timestamp, success) VALUES (?, ?, ?)");
      const recent = new Date(Date.now() - 60000).toISOString();
      db.transaction(() => { for (let i = 0; i < 100000; i++) insert.run(`provider-${i % 10}`, recent, i % 2); })();
      const cpu = async () => await (await fetch(server.base + "/api/process-health/cpu", { headers: { cookie } })).json() as { userMicroseconds: number; systemMicroseconds: number };
      const before = await cpu();
      const start = performance.now();
      const response = await fetch(server.base + "/api/process-health/dispatch", { headers: { cookie } });
      const body = await response.json() as any;
      const elapsed = performance.now() - start;
      const after = await cpu();
      console.log(`dispatch 100k rows: wall=${elapsed.toFixed(1)}ms child_cpu=${((after.userMicroseconds + after.systemMicroseconds - before.userMicroseconds - before.systemMicroseconds) / 1000).toFixed(1)}ms`);
      expect(response.status).toBe(200);
      expect(body.providers.reduce((n: number, p: any) => n + p.day.requests, 0)).toBe(100000);
    } finally { db.close(); }
  } finally {
    if (proc) await stopTestProcess(proc);
    rmSync(dir, { recursive: true, force: true });
  }
}, 60000);

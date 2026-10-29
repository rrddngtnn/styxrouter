import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { startTestServer } from "./helpers/start-test-server";
import { stopTestProcess } from "./helpers/stop-test-process";

test("single cooldown release is atomic, authenticated, and retains reset semantics", async () => {
  const { proc, base } = await startTestServer(process.execPath, { cwd: `${import.meta.dir}/..`, env: { ...process.env, STYX_TEST_MODE: "1", JWT_SECRET: "fixture-jwt-secret-01234567890123456789", INITIAL_PASSWORD: "fixture-password", STORAGE_ENCRYPTION_KEY: "fixture-encryption-key" } });
  try {
    const login = await fetch(base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "fixture-password" }) });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const created = await fetch(base + "/api/connections", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ provider: "openai", name: "Fixture", apiKey: "fixture-key" }) });
    expect(created.status).toBe(201);
    const { id } = await created.json() as { id: string };
    const path = base + `/api/connections/${id}/release-cooldown`;
    const post = (headers: Record<string, string> = {}) => fetch(path, { method: "POST", headers });
    expect((await post()).status).toBe(401);
    expect((await post({ cookie, origin: "https://evil.example" })).status).toBe(403);
    expect((await fetch(base + "/api/connections/missing/release-cooldown", { method: "POST", headers: { cookie } })).status).toBe(404);
    const db = new Database(`${process.env.STYX_DATA_DIR}/storage.sqlite`);
    try {
      db.run("UPDATE provider_connections SET backoff_level = 3, rate_limited_until = ?, test_status = 'banned', last_error = 'terminal', error_code = '403' WHERE id = ?", ["2099-01-01T00:00:00.000Z", id]);
      db.exec("CREATE TRIGGER reject_single_audit BEFORE INSERT ON audit_log WHEN NEW.action = 'connection.release-cooldown' BEGIN SELECT RAISE(ABORT, 'audit denied'); END");
      const failed = await post({ cookie });
      expect(failed.status).toBeGreaterThanOrEqual(500);
      expect(db.query("SELECT backoff_level, rate_limited_until, test_status, last_error, error_code FROM provider_connections WHERE id = ?").get(id)).toEqual({ backoff_level: 3, rate_limited_until: "2099-01-01T00:00:00.000Z", test_status: "banned", last_error: "terminal", error_code: "403" });
      db.exec("DROP TRIGGER reject_single_audit");
      expect((await post({ cookie })).status).toBe(200);
      expect(db.query("SELECT backoff_level, rate_limited_until, test_status, last_error, error_code FROM provider_connections WHERE id = ?").get(id)).toEqual({ backoff_level: 0, rate_limited_until: null, test_status: "active", last_error: null, error_code: null });
      expect(db.query("SELECT action FROM audit_log WHERE action = 'connection.release-cooldown' AND target = ?").all(id)).toHaveLength(1);
    } finally { db.close(); }
  } finally { await stopTestProcess(proc); }
}, 60000);

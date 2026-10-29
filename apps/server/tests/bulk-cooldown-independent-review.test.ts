import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { startTestServer } from "./helpers/start-test-server";
import { stopTestProcess } from "./helpers/stop-test-process";

test("bulk cooldown rolls back on audit failure and enforces request boundaries", async () => {
  const { proc, base } = await startTestServer(process.execPath, { cwd: `${import.meta.dir}/..`, env: { ...process.env, STYX_TEST_MODE: "1", JWT_SECRET: "fixture-jwt-secret-01234567890123456789", INITIAL_PASSWORD: "fixture-password", STORAGE_ENCRYPTION_KEY: "fixture-encryption-key" } });
  try {
    const login = await fetch(base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "fixture-password" }) });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const post = (path: string, body: unknown, headers: Record<string,string> = {}) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    const created = await post("/api/connections", { provider: "openai", name: "Original", apiKey: "fixture-secret-key" }, { cookie });
    expect(created.status).toBe(201);
    const { id } = await created.json() as { id: string };
    const path = "/api/connections/bulk-release-cooldown";
    expect((await post(path, { ids: [id] })).status).toBe(401);
    expect((await post(path, { ids: [id] }, { cookie, origin: "https://evil.example" })).status).toBe(403);
    for (const body of [{ ids: [] }, { ids: [id, id] }, { ids: ["x".repeat(201)] }, { ids: Array.from({length: 101}, (_, i) => String(i)) }, { ids: [id], extra: true }]) expect((await post(path, body, { cookie })).status).toBe(400);
    const db = new Database(`${process.env.STYX_DATA_DIR}/storage.sqlite`);
    try {
      db.run("UPDATE provider_connections SET backoff_level = 3, rate_limited_until = ?, test_status = 'rate_limited' WHERE id = ?", ["2099-01-01T00:00:00.000Z", id]);
      db.exec("CREATE TRIGGER reject_cooldown_audit BEFORE INSERT ON audit_log WHEN NEW.action = 'connection.release-cooldown' BEGIN SELECT RAISE(ABORT, 'audit denied'); END");
      const response = await post(path, { ids: [id] }, { cookie, origin: base });
      const text = await response.text();
      expect(text).not.toContain("fixture-secret-key");
      expect(JSON.parse(text).results[0].success).toBe(false);
      expect(db.query("SELECT backoff_level, rate_limited_until, test_status FROM provider_connections WHERE id = ?").get(id)).toEqual({ backoff_level: 3, rate_limited_until: "2099-01-01T00:00:00.000Z", test_status: "rate_limited" });
      db.exec("DROP TRIGGER reject_cooldown_audit");
      const ok = await post(path, { ids: [id] }, { cookie });
      expect((await ok.json() as any).results[0].success).toBe(true);
      expect(db.query("SELECT backoff_level, rate_limited_until FROM provider_connections WHERE id = ?").get(id)).toEqual({ backoff_level: 0, rate_limited_until: null });
      expect(db.query("SELECT action FROM audit_log WHERE action = 'connection.release-cooldown' AND target = ?").all(id)).toHaveLength(1);
      db.run("UPDATE provider_connections SET test_status = 'banned', last_error = 'terminal failure', error_code = '403', backoff_level = 2, rate_limited_until = ? WHERE id = ?", ["2099-01-01T00:00:00.000Z", id]);
      expect((await (await post(path, { ids: [id] }, { cookie })).json() as any).results[0].success).toBe(true);
      expect(db.query("SELECT test_status, last_error, error_code, backoff_level, rate_limited_until FROM provider_connections WHERE id = ?").get(id)).toEqual({ test_status: 'banned', last_error: 'terminal failure', error_code: '403', backoff_level: 0, rate_limited_until: null });
    } finally { db.close(); }
  } finally { await stopTestProcess(proc); }
}, 60000);

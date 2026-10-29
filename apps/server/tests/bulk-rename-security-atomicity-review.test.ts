import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { startTestServer } from "./helpers/start-test-server";
import { stopTestProcess } from "./helpers/stop-test-process";

 test("bulk rename enforces auth and CSRF and rolls back when its audit insert fails", async () => {
  const { proc, base } = await startTestServer(process.execPath, { cwd: `${import.meta.dir}/..`, env: { ...process.env, STYX_TEST_MODE: "1", JWT_SECRET: "fixture-jwt-secret-01234567890123456789", INITIAL_PASSWORD: "fixture-password", STORAGE_ENCRYPTION_KEY: "fixture-encryption-key" } });
  try {
    const login = await fetch(base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "fixture-password" }) });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const post = (path: string, body: unknown, headers: Record<string,string> = {}) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    const created = await post("/api/connections", { provider: "openai", name: "Original", apiKey: "fixture-secret-key" }, { cookie });
    expect(created.status).toBe(201);
    const { id } = await created.json() as { id: string };
    const request = { ids: [id], pattern: "Renamed" };
    expect((await post("/api/connections/bulk-rename", request)).status).toBe(401);
    expect((await post("/api/connections/bulk-rename", request, { cookie, origin: "https://evil.example" })).status).toBe(403);
    expect((await post("/api/connections/bulk-rename", { ...request, extra: true }, { cookie })).status).toBe(400);
    const db = new Database(`${process.env.STYX_DATA_DIR}/storage.sqlite`);
    try {
      db.exec("CREATE TRIGGER reject_rename_audit BEFORE INSERT ON audit_log WHEN NEW.action = 'connection.update' BEGIN SELECT RAISE(ABORT, 'audit denied'); END");
      const response = await post("/api/connections/bulk-rename", request, { cookie, origin: base });
      const body = await response.json() as any;
      expect(JSON.stringify(body)).not.toContain("fixture-secret-key");
      expect(body.results[0].success).toBe(false);
      expect((db.query("SELECT name FROM provider_connections WHERE id = ?").get(id) as any).name).toBe("Original");
      db.exec("DROP TRIGGER reject_rename_audit");
      const badBodies = [ { ids: [], pattern: "x" }, { ids: [id, id], pattern: "x" }, { ids: [id], pattern: "" }, { ids: [id], pattern: "x".repeat(201) }, { ids: Array(101).fill("x"), pattern: "x" } ];
      for (const invalid of badBodies) expect((await post("/api/connections/bulk-rename", invalid, { cookie })).status).toBe(400);
      const invalidName = await post("/api/connections/bulk-rename", { ids: [id], pattern: "  " }, { cookie });
      expect((await invalidName.json() as any).results[0].success).toBe(false);
      const concurrent = await Promise.all(Array.from({ length: 8 }, () => post("/api/connections/bulk-rename", { ids: [id], pattern: "{name}x" }, { cookie })));
      for (const r of concurrent) {
        const text = await r.text();
        expect(text).not.toContain("fixture-secret-key");
        expect(JSON.parse(text).results[0].success).toBe(true);
      }
      expect((db.query("SELECT name FROM provider_connections WHERE id = ?").get(id) as any).name).toBe("Originalxxxxxxxx");
      const audits = db.query("SELECT details, metadata FROM audit_log WHERE action = 'connection.update' AND target = ?").all(id);
      expect(audits).toHaveLength(8);
      expect(JSON.stringify(audits)).not.toContain("fixture-secret-key");
    } finally { db.close(); }
  } finally { await stopTestProcess(proc); }
}, 60000);

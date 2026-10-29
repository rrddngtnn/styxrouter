import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { startTestServer } from "./helpers/start-test-server";
import { stopTestProcess } from "./helpers/stop-test-process";

test("activation HTTP enforces auth and origin, rolls back audit failures, and serializes opposing writers", async () => {
  const options = { cwd: `${import.meta.dir}/..`, env: { ...process.env, STYX_TEST_MODE: "1", JWT_SECRET: "fixture-jwt-secret-01234567890123456789", INITIAL_PASSWORD: "fixture-password", STORAGE_ENCRYPTION_KEY: "fixture-encryption-key" } };
  const a = await startTestServer(process.execPath, options);
  let b: Awaited<ReturnType<typeof startTestServer>> | undefined;
  try {
    b = await startTestServer(process.execPath, options);
    const login = await fetch(a.base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "fixture-password" }) });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const post = (base: string, path: string, body: unknown, headers: Record<string, string> = {}) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    const created = await post(a.base, "/api/connections", { provider: "openai", name: "Synthetic", apiKey: "fixture-secret-713" }, { cookie });
    expect(created.status).toBe(201);
    const { id } = await created.json() as { id: string };
    const path = "/api/connections/bulk-activation";
    expect((await post(a.base, path, { ids: [id], isActive: false })).status).toBe(401);
    expect((await post(a.base, path, { ids: [id], isActive: false }, { cookie, origin: "https://evil.example" })).status).toBe(403);
    const db = new Database(`${process.env.STYX_DATA_DIR}/storage.sqlite`);
    try {
      db.exec("CREATE TRIGGER reject_activation_audit BEFORE INSERT ON audit_log WHEN NEW.action = 'connection.update' BEGIN SELECT RAISE(ABORT, 'audit denied'); END");
      const rejected = await post(a.base, path, { ids: [id], isActive: false }, { cookie, origin: a.base });
      expect((await rejected.json() as any).results[0]).toMatchObject({ id, success: false });
      expect(db.query("SELECT is_active FROM provider_connections WHERE id = ?").get(id)).toEqual({ is_active: 1 });
      db.exec("DROP TRIGGER reject_activation_audit");
      // Prime the second server's connection-list cache before the first server disables it.
      expect((await fetch(b.base + "/api/connections", { headers: { cookie } })).status).toBe(200);
      expect((await (await post(a.base, path, { ids: [id], isActive: false }, { cookie })).json() as any).results[0].success).toBe(true);
      const list = await (await fetch(b.base + "/api/connections", { headers: { cookie } })).json() as any;
      const connections = Array.isArray(list) ? list : list.connections;
      expect(connections.find((row: any) => row.id === id).isActive).toBe(false);
      for (let i = 0; i < 8; i++) {
        const responses = await Promise.all([post(a.base, path, { ids: [id], isActive: true }, { cookie }), post(b.base, path, { ids: [id], isActive: false }, { cookie })]);
        for (const r of responses) expect((await r.json() as any).results[0].success).toBe(true);
      }
      const audits = db.query("SELECT details FROM audit_log WHERE action = 'connection.update' AND target = ? ORDER BY rowid").all(id) as { details: string }[];
      expect(audits).toHaveLength(17);
      expect(db.query("SELECT is_active FROM provider_connections WHERE id = ?").get(id)).toEqual({ is_active: JSON.parse(audits.at(-1)!.details).isActive ? 1 : 0 });
    } finally { db.close(); }
  } finally { if (b) await stopTestProcess(b.proc); await stopTestProcess(a.proc); }
}, 60000);

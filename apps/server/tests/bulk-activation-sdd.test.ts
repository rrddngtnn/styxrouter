import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { startTestServer } from "./helpers/start-test-server";
import { stopTestProcess } from "./helpers/stop-test-process";

test("bulk activation changes only selected accounts and audits each successful change", async () => {
  const { proc, base } = await startTestServer(process.execPath, { cwd: `${import.meta.dir}/..`, env: { ...process.env, STYX_TEST_MODE: "1", JWT_SECRET: "fixture-jwt-secret-01234567890123456789", INITIAL_PASSWORD: "fixture-password", STORAGE_ENCRYPTION_KEY: "fixture-encryption-key" } });
  try {
    const login = await fetch(base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "fixture-password" }) });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const post = (path: string, body: unknown, auth = true) => fetch(base + path, { method: "POST", headers: { ...(auth ? { cookie } : {}), "content-type": "application/json" }, body: JSON.stringify(body) });
    const create = async (name: string) => (await (await post("/api/connections", { provider: "openai", name, apiKey: `fixture-${name}` })).json() as any).id as string;
    const selected = await create("selected");
    const other = await create("other");
    const r = await post("/api/connections/bulk-activation", { ids: [selected, "missing"], isActive: false });
    expect(r.status).toBe(200);
    expect((await r.json() as any).results).toEqual([{ id: selected, success: true, isActive: false }, { id: "missing", success: false, error: "Connection not found" }]);
    const db = new Database(join(process.env.DATA_DIR!, "storage.sqlite"), { readonly: true });
    try {
      expect(db.query("SELECT is_active FROM provider_connections WHERE id = ?").get(selected)).toEqual({ is_active: 0 });
      expect(db.query("SELECT is_active FROM provider_connections WHERE id = ?").get(other)).toEqual({ is_active: 1 });
      expect(db.query("SELECT count(*) AS n FROM audit_log WHERE action = 'connection.update' AND target = ?").get(selected)).toEqual({ n: 1 });
    } finally { db.close(); }
    expect((await post("/api/connections/bulk-activation", { ids: [selected, selected], isActive: true })).status).toBe(400);
    expect((await post("/api/connections/bulk-activation", { ids: [selected], isActive: true, extra: 1 })).status).toBe(400);
    expect((await post("/api/connections/bulk-activation", { ids: [selected], isActive: true }, false)).status).toBe(401);
    const enabled = await post("/api/connections/bulk-activation", { ids: [selected], isActive: true });
    expect((await enabled.json() as any).results).toEqual([{ id: selected, success: true, isActive: true }]);
  } finally { await stopTestProcess(proc); }
}, 60000);

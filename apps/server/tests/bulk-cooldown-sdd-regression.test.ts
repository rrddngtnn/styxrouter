import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { startTestServer } from "./helpers/start-test-server";
import { stopTestProcess } from "./helpers/stop-test-process";

test("bulk cooldown release reports each selected account independently", async () => {
  const { proc, base } = await startTestServer(process.execPath, { cwd: `${import.meta.dir}/..`, env: { ...process.env, STYX_TEST_MODE: "1", JWT_SECRET: "fixture-jwt-secret-01234567890123456789", INITIAL_PASSWORD: "fixture-password", STORAGE_ENCRYPTION_KEY: "fixture-encryption-key" } });
  try {
    const login = await fetch(base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "fixture-password" }) });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const post = (path: string, body: unknown) => fetch(base + path, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) });
    const created = await post("/api/connections", { provider: "openai", name: "Selected", apiKey: "synthetic-key" });
    expect(created.status).toBe(201);
    const { id } = await created.json() as any;
    const other = await post("/api/connections", { provider: "openai", name: "Not selected", apiKey: "another-synthetic-key" });
    expect(other.status).toBe(201);
    const otherId = (await other.json() as any).id;
    const db = new Database(join(process.env.DATA_DIR!, "storage.sqlite"));
    try {
      db.run("UPDATE provider_connections SET backoff_level = 3, rate_limited_until = ? WHERE id IN (?, ?)", ["2099-01-01T00:00:00.000Z", id, otherId]);
    } finally { db.close(); }
    const response = await post("/api/connections/bulk-release-cooldown", { ids: [id, "missing-account"] });
    expect(response.status).toBe(200);
    expect((await response.json() as any).results).toEqual([{ id, success: true }, { id: "missing-account", success: false, error: "Connection not found" }]);
    const verify = new Database(join(process.env.DATA_DIR!, "storage.sqlite"), { readonly: true });
    try {
      const get = verify.query("SELECT backoff_level, rate_limited_until FROM provider_connections WHERE id = ?");
      expect(get.get(id)).toEqual({ backoff_level: 0, rate_limited_until: null });
      expect(get.get(otherId)).toEqual({ backoff_level: 3, rate_limited_until: "2099-01-01T00:00:00.000Z" });
    } finally { verify.close(); }
    expect((await post("/api/connections/bulk-release-cooldown", { ids: [id, id] })).status).toBe(400);
    expect((await fetch(base + "/api/connections/bulk-release-cooldown", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: [id] }) })).status).toBe(401);
  } finally { await stopTestProcess(proc); }
}, 60000);

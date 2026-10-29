import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { startTestServer } from "./helpers/start-test-server";

test("two servers reject concurrent Codex bulk imports without touching shared credentials", async () => {
  const dir = mkdtempSync(join(tmpdir(), "codex-import-block-"));
  const env = { ...process.env, DATA_DIR: dir, STYX_TEST_MODE: "1", JWT_SECRET: "synthetic-jwt-secret-0123456789abcdef", API_KEY_SECRET: "synthetic-api-secret-0123456789abcdef", INITIAL_PASSWORD: "synthetic-password" };
  const servers: Awaited<ReturnType<typeof startTestServer>>[] = [];
  try {
    for (let i = 0; i < 2; i++) servers.push(await startTestServer(process.execPath, { cwd: join(import.meta.dir, ".."), env }));
    const cookies = await Promise.all(servers.map(async s => {
      const login = await fetch(s.base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "synthetic-password" }) });
      expect(login.status).toBe(200);
      return (login.headers.get("set-cookie") ?? "").split(";")[0];
    }));
    const requests = servers.map((s, i) => fetch(s.base + "/api/oauth/codex/import", {
      method: "POST", headers: { cookie: cookies[i], origin: s.base, "content-type": "application/json" },
      body: JSON.stringify({ accounts: { email: "synthetic@example.test", access_token: "synthetic-access", refresh_token: "synthetic-refresh" } }),
    }));
    const responses = await Promise.all(requests);
    expect(responses.map(r => r.status)).toEqual([409, 409]);
    for (const response of responses) expect(await response.text()).not.toContain("synthetic-refresh");
    const db = new Database(join(dir, "storage.sqlite"), { readonly: true });
    try { expect(db.query("SELECT count(*) n FROM provider_connections WHERE provider = 'codex'").get()).toEqual({ n: 0 }); } finally { db.close(); }
  } finally {
    await Promise.all(servers.map(({ proc }) => new Promise<void>(resolve => { if (proc.exitCode !== null || proc.signalCode !== null) return resolve(); proc.once("exit", () => resolve()); proc.kill("SIGKILL"); })));
    rmSync(dir, { recursive: true, force: true });
  }
}, 60000);

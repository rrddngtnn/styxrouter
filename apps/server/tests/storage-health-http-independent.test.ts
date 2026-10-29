import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startTestServer } from "./helpers/start-test-server";
import { stopTestProcess } from "./helpers/stop-test-process";

test("storage health HTTP requires a session and reports only configured file sizes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "storage-health-review-"));
  let proc: Awaited<ReturnType<typeof startTestServer>>["proc"] | undefined;
  try {
    const server = await startTestServer(process.execPath, { cwd: join(import.meta.dir, ".."), env: { ...process.env, DATA_DIR: dir, STYX_TEST_MODE: "1", JWT_SECRET: "fixture-jwt-secret-01234567890123456789", INITIAL_PASSWORD: "fixture-password" } });
    proc = server.proc;
    const endpoint = server.base + "/api/storage-health";
    for (const headers of [{}, { cookie: "auth_token=invalid" }, { authorization: "Bearer invalid" }]) {
      const denied = await fetch(endpoint, { headers });
      expect(denied.status).toBe(401);
      expect(await denied.text()).not.toContain(dir);
    }
    const login = await fetch(server.base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "fixture-password" }) });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const response = await fetch(endpoint + "?path=%2Fetc%2Fpasswd", { headers: { cookie } });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const text = await response.text();
    expect(text).not.toContain(dir);
    expect(text).not.toContain("passwd");
    const data = JSON.parse(text);
    expect(Object.keys(data).sort()).toEqual(["databaseBytes", "walBytes"]);
    expect(data.databaseBytes).toBe(statSync(join(dir, "storage.sqlite")).size);
    let wal: number | null = null;
    try { wal = statSync(join(dir, "storage.sqlite-wal")).size; } catch {}
    expect(data.walBytes).toBe(wal);
  } finally {
    if (proc) await stopTestProcess(proc);
    rmSync(dir, { recursive: true, force: true });
  }
}, 60000);

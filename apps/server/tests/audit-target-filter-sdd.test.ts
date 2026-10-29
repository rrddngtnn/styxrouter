import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startTestServer } from "./helpers/start-test-server";
import { stopTestProcess } from "./helpers/stop-test-process";

let proc: Awaited<ReturnType<typeof startTestServer>>["proc"];
let base = "", cookie = "", dataDir = "";
beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "audit-filter-"));
  ({ proc, base } = await startTestServer(process.execPath, { cwd: import.meta.dir + "/..", env: {
    ...process.env, DATA_DIR: dataDir, STYX_TEST_MODE: "1", JWT_SECRET: "audit-filter-test-jwt-secret-0123456789", API_KEY_SECRET: "audit-filter-test-key-secret-0123456789", INITIAL_PASSWORD: "audit-filter-password",
  } }));
  const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "audit-filter-password" }) });
  expect(login.status).toBe(200);
  cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
}, 110000);
afterAll(async () => { if (proc) await stopTestProcess(proc); if (dataDir) rmSync(dataDir, { recursive: true, force: true }); }, 10000);

test("audit target filter applies to entries and total for authenticated requests", async () => {
  const ids: string[] = [];
  for (const prefix of ["audit-filter-a", "audit-filter-b"]) {
    const response = await fetch(`${base}/api/provider-nodes`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ type: "openai-compatible", name: prefix, prefix, apiType: "chat", baseUrl: "https://example.com/v1" }) });
    expect(response.status).toBe(201);
    ids.push(((await response.json()) as any).node.id);
  }
  const query = `/api/audit-log?action=providerNode.create&target=${encodeURIComponent(ids[0])}`;
  expect((await fetch(base + query)).status).toBe(401);
  const response = await fetch(base + query, { headers: { cookie } });
  expect(response.status).toBe(200);
  const result: any = await response.json();
  expect(result.total).toBe(1);
  expect(result.entries.map((entry: any) => entry.target)).toEqual([ids[0]]);
});

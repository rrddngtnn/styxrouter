import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startTestServer } from "./helpers/start-test-server";
import { stopTestProcess } from "./helpers/stop-test-process";

let proc: Awaited<ReturnType<typeof startTestServer>>["proc"];
let base = "", cookie = "", dataDir = "";
let ids: string[] = [];
beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "audit-independent-"));
  ({ proc, base } = await startTestServer(process.execPath, { cwd: process.cwd(), env: {
    ...process.env, DATA_DIR: dataDir, STYX_TEST_MODE: "1", JWT_SECRET: "audit-review-jwt-secret-0123456789", API_KEY_SECRET: "audit-review-key-secret-0123456789", INITIAL_PASSWORD: "audit-review-password",
  } }));
  const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "audit-review-password" }) });
  expect(login.status).toBe(200);
  cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
  for (const prefix of ["audit-review-a", "audit-review-b"]) {
    const r = await fetch(`${base}/api/provider-nodes`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ type: "openai-compatible", name: prefix, prefix, apiType: "chat", baseUrl: "https://example.com/v1" }) });
    expect(r.status).toBe(201);
    ids.push(((await r.json()) as any).node.id);
  }
  const update = await fetch(`${base}/api/provider-nodes/${ids[0]}`, { method: "PATCH", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ name: "audit-review-updated" }) });
  expect(update.status).toBe(200);
}, 110000);
afterAll(async () => { if (proc) await stopTestProcess(proc); if (dataDir) rmSync(dataDir, { recursive: true, force: true }); }, 10000);

test("target is exact and wildcard and SQL injection inputs cannot broaden results", async () => {
  for (const target of [ids[0].slice(0, 8), "%", "_", "' OR 1=1 --"]) {
    const r = await fetch(`${base}/api/audit-log?target=${encodeURIComponent(target)}`, { headers: { cookie } });
    expect(r.status).toBe(200);
    const body: any = await r.json();
    expect(body.total).toBe(0);
    expect(body.entries).toEqual([]);
  }
});

test("blank target does not expose the unfiltered log", async () => {
  for (const target of ["", "   "]) {
    const r = await fetch(`${base}/api/audit-log?target=${encodeURIComponent(target)}`, { headers: { cookie } });
    expect(r.status).toBe(400);
  }
});

test("authenticated exact target pagination retains total and deterministic rows", async () => {
  const q = `target=${encodeURIComponent(ids[0])}&limit=1`;
  expect((await fetch(`${base}/api/audit-log?${q}`)).status).toBe(401);
  const first: any = await (await fetch(`${base}/api/audit-log?${q}&offset=0`, { headers: { cookie } })).json();
  const repeat: any = await (await fetch(`${base}/api/audit-log?${q}&offset=0`, { headers: { cookie } })).json();
  const next: any = await (await fetch(`${base}/api/audit-log?${q}&offset=1`, { headers: { cookie } })).json();
  expect(first.total).toBe(2);
  expect(first.entries.map((e: any) => e.target)).toEqual([ids[0]]);
  expect(repeat).toEqual(first);
  expect(next.total).toBe(2);
  expect(next.entries.map((e: any) => e.target)).toEqual([ids[0]]);
  expect(next.entries[0].id).not.toBe(first.entries[0].id);
});

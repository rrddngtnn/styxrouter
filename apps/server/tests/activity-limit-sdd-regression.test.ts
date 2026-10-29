import { expect, test } from "bun:test";
import { getDbInstance } from "../src/lib/db/core";
import { startTestServer } from "./helpers/start-test-server";
import { stopTestProcess } from "./helpers/stop-test-process";

test("activity call-log pagination caps oversized limits at 500", async () => {
  const db = getDbInstance();
  const insert = db.prepare("INSERT INTO call_logs (id, timestamp, status, detail_state) VALUES (?, ?, ?, ?)");
  for (let i = 0; i < 501; i++) insert.run(`sdd-${i}`, new Date(1700000000000 + i * 1000).toISOString(), 200, "none");
  const password = "fixture-activity-password";
  const { proc, base } = await startTestServer(process.execPath, { cwd: `${import.meta.dir}/..`, env: { ...process.env, STYX_TEST_MODE: "1", INITIAL_PASSWORD: password, JWT_SECRET: "fixture-activity-secret-0123456789012345" } });
  try {
    const path = `${base}/api/usage/call-logs?limit=999999`;
    expect((await fetch(path)).status).toBe(401);
    const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const response = await fetch(path, { headers: { cookie } });
    expect(response.status).toBe(200);
    const rows = await response.json() as any[];
    expect(rows.length).toBe(500);
    expect(rows[0].id).toBe("sdd-500");
    const page = await fetch(`${base}/api/usage/call-logs?limit=3&offset=499`, { headers: { cookie } });
    expect((await page.json() as any[]).map(r => r.id)).toEqual(["sdd-1", "sdd-0"]);
  } finally { await stopTestProcess(proc); }
}, 60000);

import { expect, test } from "bun:test";
import { getDbInstance } from "../src/lib/db/core";
import { getPendingById } from "../src/lib/usage/usageHistory";
import { storeCompletedDetail, clearCompletedDetails } from "../src/lib/usage/completedRequestDetails";

 test("authenticated list and historical detail protect opaque URLs across active completed and legacy errors and arrays", async () => {
  process.env.STYX_TEST_MODE = "1";
  process.env.INITIAL_PASSWORD = "synthetic-audit-password";
  process.env.JWT_SECRET = "synthetic-audit-jwt-0123456789012345";
  const secret = "opaque-audit-secret-unique";
  const path = `/v1/chat/completions/${secret}?model=visible`;
  const error = `failure https://example.invalid/private/${secret}?model=visible`;
  const db = getDbInstance();
  const timestamp = new Date().toISOString();
  db.prepare("INSERT INTO call_logs (id, timestamp, path, status, detail_state, error_summary) VALUES (?, ?, ?, ?, ?, ?)").run("audit-legacy", timestamp, path, 500, "legacy-inline", error);
  db.prepare("CREATE TABLE IF NOT EXISTS call_logs_v1_legacy (id TEXT PRIMARY KEY, request_body TEXT, response_body TEXT, error TEXT)").run();
  db.prepare("INSERT INTO call_logs_v1_legacy (id, request_body, response_body, error) VALUES (?, ?, ?, ?)").run("audit-legacy", JSON.stringify({ errors: [error], endpoint: path }), JSON.stringify([error]), JSON.stringify({ messages: [error] }));
  const detail = (id: string) => ({ id, model: "fixture", provider: "fixture", connectionId: null, startedAt: Date.now(), clientEndpoint: path, error });
  getPendingById().set("audit-active", detail("audit-active"));
  storeCompletedDetail(detail("audit-completed"));
  const { default: config } = await import("../server/styx");
  const server = Bun.serve({ ...config, hostname: "127.0.0.1", port: 0 });
  const base = `http://127.0.0.1:${server.port}`;
  try {
    expect((await fetch(`${base}/api/usage/call-logs`)).status).toBe(401);
    const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: process.env.INITIAL_PASSWORD }) });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const list = await fetch(`${base}/api/usage/call-logs?limit=100`, { headers: { cookie } });
    expect(list.status).toBe(200);
    const rows = await list.json() as any[];
    for (const id of ["audit-active", "audit-completed"]) {
      expect((await fetch(`${base}/api/usage/call-logs/${id}`, { headers: { cookie } })).status).toBe(404);
    }
    const response = await fetch(`${base}/api/usage/call-logs/audit-legacy`, { headers: { cookie } });
    expect(response.status).toBe(200);
    const legacy = await response.json() as any;
    const checks: [string, unknown][] = [
      ["active list path", rows.find(r => r.id === "audit-active")?.path],
      ["completed list path", rows.find(r => r.id === "audit-completed")?.path],
      ["completed list error", rows.find(r => r.id === "audit-completed")?.error],
      ["legacy list path", rows.find(r => r.id === "audit-legacy")?.path],
      ["legacy list error", rows.find(r => r.id === "audit-legacy")?.error],
      ["legacy detail path", legacy.path], ["legacy detail error", legacy.error],
      ["legacy request array", legacy.requestBody], ["legacy response array", legacy.responseBody],
    ];
    const failures = checks.filter(([,value]) => value == null || JSON.stringify(value).includes(secret)).map(([label]) => label);
    expect(failures).toEqual([]);
    expect((db.prepare("SELECT error_summary FROM call_logs WHERE id = ?").get("audit-legacy") as any).error_summary).toBe(error);
    expect((db.prepare("SELECT error FROM call_logs_v1_legacy WHERE id = ?").get("audit-legacy") as any).error).toContain(secret);
  } finally { server.stop(true); getPendingById().clear(); clearCompletedDetails(); }
}, 60000);

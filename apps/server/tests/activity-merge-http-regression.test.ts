import { expect, test } from "bun:test";
import { getDbInstance } from "../src/lib/db/core";
import { getPendingById } from "../src/lib/usage/usageHistory";
import { storeCompletedDetail } from "../src/lib/usage/completedRequestDetails";

test("HTTP pagination merges pending, completed and persisted rows before applying offset", async () => {
  process.env.STYX_TEST_MODE = "1";
  process.env.INITIAL_PASSWORD = "fixture-activity-password";
  process.env.JWT_SECRET = "fixture-activity-secret-0123456789012345";
  const db = getDbInstance();
  const insert = db.prepare("INSERT INTO call_logs (id, timestamp, status, detail_state, model, requested_model, path) VALUES (?, ?, 200, 'none', ?, ?, ?)");
  insert.run("db1", "2024-01-03T00:00:00.000Z", "other", "target", "/v1/chat");
  insert.run("db2", "2024-01-02T00:00:00.000Z", "target", null, "/v1/chat");
  const detail = (id: string, model: string, path = "/v1/chat") => ({ id, model, provider: "fixture", connectionId: null, startedAt: 1704326400000, clientEndpoint: path });
  getPendingById().set("pending", detail("pending", "target"));
  getPendingById().set("internal", detail("internal", "target", "/api/providers/test"));
  storeCompletedDetail(detail("completed", "target"));
  storeCompletedDetail(detail("db2", "target"));
  const { default: config } = await import("../server/styx");
  const server = Bun.serve({ ...config, hostname: "127.0.0.1", port: 0 });
  const base = `http://127.0.0.1:${server.port}`;
  try {
    const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: process.env.INITIAL_PASSWORD }) });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const ids = async (query: string) => {
      const response = await fetch(`${base}/api/usage/call-logs?${query}`, { headers: { cookie } });
      expect(response.status).toBe(200);
      return (await response.json() as any[]).map(row => row.id);
    };
    expect(await ids("model=target&excludeTests=1&limit=2")).toEqual(["pending", "completed"]);
    expect(await ids("model=target&excludeTests=1&limit=2&offset=2")).toEqual(["db1", "db2"]);
    expect(await ids("model=target&excludeTests=1&limit=1&offset=1")).toEqual(["completed"]);
  } finally { server.stop(true); }
}, 60000);

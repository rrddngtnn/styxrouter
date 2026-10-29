import { expect, test } from "bun:test";
import { getDbInstance } from "../src/lib/db/core";
import { getPendingById } from "../src/lib/usage/usageHistory";
import { storeCompletedDetail } from "../src/lib/usage/completedRequestDetails";

test("HTTP pages use stable ID ordering for equal timestamps across memory and database", async () => {
  process.env.STYX_TEST_MODE = "1";
  process.env.INITIAL_PASSWORD = "fixture-activity-password";
  process.env.JWT_SECRET = "fixture-activity-secret-0123456789012345";
  const db = getDbInstance();
  const insert = db.prepare("INSERT INTO call_logs (id, timestamp, status, detail_state, model, path) VALUES (?, ?, 200, 'none', 'target', '/v1/chat')");
  for (const id of ["db-a", "db-c", "db-b"]) insert.run(id, "2024-01-01T00:00:00.000Z");
  const detail = (id: string) => ({ id, model: "target", provider: "fixture", connectionId: null, startedAt: 1704067200000, clientEndpoint: "/v1/chat" });
  for (const id of ["pending-a", "pending-c", "pending-b"]) getPendingById().set(id, detail(id));
  for (const id of ["complete-a", "complete-c", "complete-b"]) storeCompletedDetail(detail(id));
  const { default: config } = await import("../server/styx");
  const server = Bun.serve({ ...config, hostname: "127.0.0.1", port: 0 });
  const base = `http://127.0.0.1:${server.port}`;
  try {
    const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: process.env.INITIAL_PASSWORD }) });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const ids: string[] = [];
    for (let offset = 0; offset < 9; offset += 2) {
      const response = await fetch(`${base}/api/usage/call-logs?model=target&limit=2&offset=${offset}`, { headers: { cookie } });
      expect(response.status).toBe(200);
      ids.push(...(await response.json() as any[]).map(row => row.id));
    }
    expect(ids).toEqual(["pending-c", "pending-b", "pending-a", "complete-c", "complete-b", "complete-a", "db-c", "db-b", "db-a"]);
  } finally { server.stop(true); }
}, 60000);

import { expect, test } from "bun:test";
import { getDbInstance } from "../src/lib/db/core";
import { getPendingById } from "../src/lib/usage/usageHistory";
import { storeCompletedDetail } from "../src/lib/usage/completedRequestDetails";

test("memory rows obey the same SQL filter semantics as persisted rows", async () => {
  process.env.STYX_TEST_MODE = "1";
  process.env.INITIAL_PASSWORD = "fixture-activity-password";
  process.env.JWT_SECRET = "fixture-activity-secret-0123456789012345";
  const db = getDbInstance();
  db.prepare("INSERT INTO call_logs (id, timestamp, status, detail_state, model, provider, path) VALUES (?, ?, 200, 'none', ?, ?, ?)").run("db", "2024-01-01T00:00:00.000Z", "aZZb", "fixture", "/v1/chat");
  const detail = { id: "memory", model: "aZZb", provider: "fixture", connectionId: null, startedAt: 1704326400000, clientEndpoint: "/v1/chat", status: 200 };
  storeCompletedDetail(detail);
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
    expect(await ids("model=a%25b")).toEqual(["memory", "db"]);
    expect(await ids("search=aZZb%20fixture")).toEqual([]);
    expect(await ids("status=200junk")).toEqual(["memory", "db"]);
  } finally { server.stop(true); getPendingById().clear(); }
}, 60000);

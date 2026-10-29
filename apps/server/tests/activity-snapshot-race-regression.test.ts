import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { getDbInstance } from "../src/lib/db/core";
import { getPendingById } from "../src/lib/usage/usageHistory";

test("HTTP snapshot avoids duplicates when pending persists between lookup and page query", async () => {
  process.env.STYX_TEST_MODE = "1";
  process.env.INITIAL_PASSWORD = "fixture-activity-password";
  process.env.JWT_SECRET = "fixture-activity-secret-0123456789012345";
  const db = getDbInstance();
  getPendingById().set("race", { id: "race", model: "target", provider: "fixture", connectionId: null, startedAt: 1704067200000, clientEndpoint: "/v1/chat" });
  const { default: config } = await import("../server/styx");
  const server = Bun.serve({ ...config, hostname: "127.0.0.1", port: 0 });
  const base = `http://127.0.0.1:${server.port}`;
  const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: process.env.INITIAL_PASSWORD }) });
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  const other = new Database(db.name);
  const original = db.prepare.bind(db);
  let injected = false;
  db.prepare = ((sql: string) => {
    if (!injected && sql.includes("SELECT cl.*") && sql.includes("FROM call_logs cl")) {
      injected = true;
      other.query("INSERT INTO call_logs (id, timestamp, status, detail_state, model, path) VALUES ('race', '2024-01-01T00:00:00.000Z', 200, 'none', 'target', '/v1/chat')").run();
    }
    return original(sql);
  }) as typeof db.prepare;
  try {
    const response = await fetch(`${base}/api/usage/call-logs?model=target&limit=2`, { headers: { cookie } });
    expect(response.status).toBe(200);
    expect(injected).toBe(true);
    expect((await response.json() as any[]).map(row => row.id)).toEqual(["race"]);
  } finally { db.prepare = original; other.close(); server.stop(true); getPendingById().delete("race"); }
}, 60000);

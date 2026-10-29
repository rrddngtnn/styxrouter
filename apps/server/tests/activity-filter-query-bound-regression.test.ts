import { expect, test } from "bun:test";
import { getDbInstance } from "../src/lib/db/core";
import { getPendingById } from "../src/lib/usage/usageHistory";

test("HTTP filtering reuses its SQLite LIKE statement across pending rows", async () => {
  process.env.STYX_TEST_MODE = "1";
  process.env.INITIAL_PASSWORD = "fixture-activity-password";
  process.env.JWT_SECRET = "fixture-activity-secret-0123456789012345";
  const db = getDbInstance();
  for (let i = 0; i < 100; i++) getPendingById().set(`bound-${i}`, { id: `bound-${i}`, model: "target", provider: "fixture", connectionId: null, startedAt: 1704067200000, clientEndpoint: "/v1/chat" });
  const { default: config } = await import("../server/styx");
  const server = Bun.serve({ ...config, hostname: "127.0.0.1", port: 0 });
  const base = `http://127.0.0.1:${server.port}`;
  const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: process.env.INITIAL_PASSWORD }) });
  expect(login.status).toBe(200);
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  const original = db.prepare.bind(db);
  let prepares = 0;
  db.prepare = ((sql: string) => { if (sql === "SELECT ? LIKE ? AS matches") prepares++; return original(sql); }) as typeof db.prepare;
  try {
    const response = await fetch(`${base}/api/usage/call-logs?model=target&limit=3`, { headers: { cookie } });
    expect(response.status).toBe(200);
    expect((await response.json() as any[]).length).toBe(3);
    expect(prepares).toBeLessThanOrEqual(1);
  } finally { db.prepare = original; server.stop(true); getPendingById().clear(); }
}, 60000);

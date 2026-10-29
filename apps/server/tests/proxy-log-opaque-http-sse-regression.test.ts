import { expect, test } from "bun:test";
import { getDbInstance } from "../src/lib/db/core";

test("proxy logs redact historical and new HTTP/SSE error URLs over authenticated HTTP", async () => {
  process.env.STYX_TEST_MODE = "1";
  process.env.INITIAL_PASSWORD = "synthetic-proxy-test-password";
  process.env.JWT_SECRET = "synthetic-proxy-jwt-secret-0123456789";
  const secret = "opaque-proxy-secret-482";
  const url = `https://example.invalid/v1/files/${secret}/content?model=visible`;
  const db = getDbInstance();
  db.prepare("INSERT INTO proxy_logs (id, timestamp, status, target_url, error) VALUES (?, ?, ?, ?, ?)").run("proxy-historical", new Date().toISOString(), "error", url, `HTTP failure ${url}`);
  const { logProxyEvent } = await import("../src/lib/proxyLogger");
  logProxyEvent({ status: "error", targetUrl: url, error: `HTTP 502 ${url}` });
  logProxyEvent({ status: "error", targetUrl: url, error: `SSE stream failure ${url}` });
  const { default: config } = await import("../server/styx");
  const server = Bun.serve({ ...config, hostname: "127.0.0.1", port: 0 });
  const base = `http://127.0.0.1:${server.port}`;
  try {
    expect((await fetch(`${base}/api/usage/proxy-logs`)).status).toBe(401);
    const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: process.env.INITIAL_PASSWORD }) });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const response = await fetch(`${base}/api/usage/proxy-logs`, { headers: { cookie } });
    expect(response.status).toBe(200);
    const rows = await response.json() as any[];
    const selected = rows.filter(r => r.id === "proxy-historical" || r.error?.includes("HTTP 502") || r.error?.includes("SSE stream failure"));
    expect(selected.length).toBe(3);
    for (const row of selected) {
      expect(row.targetUrl).toBe("https://example.invalid/v1/files/[REDACTED]/content?model=visible");
      expect(row.error).not.toContain(secret);
    }
    expect((db.prepare("SELECT target_url FROM proxy_logs WHERE id = ?").get("proxy-historical") as any).target_url).toBe(url);
  } finally { server.stop(true); }
}, 60000);

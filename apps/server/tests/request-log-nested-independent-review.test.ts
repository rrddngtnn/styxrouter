import { expect, test } from "bun:test";
import { createRequestLogger } from "../open-sse/utils/requestLogger";
import { getDbInstance } from "../src/lib/db/core";
import { saveRequestDetailLog } from "../src/lib/db/detailedLogs";
import { startTestServer } from "./helpers/start-test-server";
import { stopTestProcess } from "./helpers/stop-test-process";

test("nested cross-site URL and custom provider tokens never reach stored logs or authenticated detail", async () => {
  const secret = "synthetic-independent-review-secret-84372";
  const nested = `https://other.invalid/callback?X-Custom-Provider-Token=${secret}&model=ok`;
  const url = `https://provider.invalid/v1?redirect=${encodeURIComponent(encodeURIComponent(nested))}&model=ok`;
  const headers = { "X-Custom-Provider-Token": secret, "X-Trace": "visible" };
  const logger = await createRequestLogger();
  logger.logTargetRequest(url, headers, {});
  const pipeline = logger.getPipelinePayloads();
  expect(JSON.stringify(pipeline).includes(secret)).toBe(false);
  saveRequestDetailLog({ id: "nested-new", translated_request: { url, headers } });
  const db = getDbInstance();
  const fresh: any = db.prepare("SELECT translated_request FROM request_detail_logs WHERE id = ?").get("nested-new");
  expect(fresh.translated_request.includes(secret)).toBe(false);
  const payload = JSON.stringify({ url, headers });
  db.prepare("INSERT INTO call_logs (id, timestamp, path, status, detail_state) VALUES (?, ?, ?, ?, ?)").run("nested-call", new Date().toISOString(), url, 200, "none");
  db.prepare("INSERT INTO request_detail_logs (id, call_log_id, timestamp, translated_request) VALUES (?, ?, ?, ?)").run("nested-old", "nested-call", new Date().toISOString(), payload);
  const password = "test-only-password-362845";
  const { proc, base } = await startTestServer(process.execPath, { cwd: `${import.meta.dir}/..`, env: { ...process.env, STYX_TEST_MODE: "1", INITIAL_PASSWORD: password, JWT_SECRET: "synthetic-test-jwt-0123456789", API_KEY_SECRET: "synthetic-test-key-0123456789" } });
  try {
    const path = `${base}/api/usage/call-logs/nested-call`;
    expect((await fetch(path)).status).toBe(401);
    const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
    expect(cookie.length > 0).toBe(true);
    const response = await fetch(path, { headers: { cookie } });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text.includes(secret)).toBe(false);
    expect(text.includes("visible")).toBe(true);
    expect((db.prepare("SELECT translated_request FROM request_detail_logs WHERE id = ?").get("nested-old") as any).translated_request).toBe(payload);
  } finally { await stopTestProcess(proc); }
}, 45000);

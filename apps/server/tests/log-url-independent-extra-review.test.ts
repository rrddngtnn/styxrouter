import { expect, test } from "bun:test";
import { redactLogUrl } from "../src/lib/logUrlRedaction";
import { protectPayloadForLog } from "../src/lib/logPayloads";
import { getDbInstance } from "../src/lib/db/core";
import { startTestServer } from "./helpers/start-test-server";
import { stopTestProcess } from "./helpers/stop-test-process";

test("redacts URLs embedded in error text in authenticated historical detail", async () => {
  const secret = "synthetic-error-url-secret-unique";
  const message = `request failed for https://example.invalid/callback?code=${secret}&model=ok`;
  expect(JSON.stringify(protectPayloadForLog({ error: { message } }))).not.toContain(secret);
  const db = getDbInstance();
  const signed = `https://storage.invalid/item?X-Amz-Signature=synthetic-http-signature&model=ok`;
  const nested = `https://outer.invalid/?redirect=https://inner.invalid/callback?code=synthetic-http-nested&model=ok`;
  const payload = JSON.stringify({ error: { message }, url: signed, endpoint: nested });
  db.prepare("INSERT INTO call_logs (id, timestamp, path, status, detail_state) VALUES (?, ?, ?, ?, ?)").run("error-url-call", new Date().toISOString(), "/v1", 500, "none");
  db.prepare("INSERT INTO request_detail_logs (id, call_log_id, timestamp, translated_request) VALUES (?, ?, ?, ?)").run("error-url-detail", "error-url-call", new Date().toISOString(), payload);
  const password = "test-error-url-password";
  const { proc, base } = await startTestServer(process.execPath, { cwd: `${import.meta.dir}/..`, env: { ...process.env, STYX_TEST_MODE: "1", INITIAL_PASSWORD: password, JWT_SECRET: "synthetic-test-jwt-0123456789", API_KEY_SECRET: "synthetic-test-key-0123456789" } });
  try {
    const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
    expect(cookie).not.toBe("");
    const response = await fetch(`${base}/api/usage/call-logs/error-url-call`, { headers: { cookie } });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain(secret);
    expect(text).not.toContain("synthetic-http-signature");
    expect(text).not.toContain("synthetic-http-nested");
    expect(text).toContain("model=ok");
    expect((db.prepare("SELECT translated_request FROM request_detail_logs WHERE id = ?").get("error-url-detail") as any).translated_request).toBe(payload);
  } finally { await stopTestProcess(proc); }
}, 45000);

test("redacts credentials in unencoded nested URL query parameters", () => {
  const secret = "synthetic-nested-auth-unique";
  const url = `https://outer.invalid/?redirect=https://inner.invalid/callback?code=${secret}&model=visible`;
  expect(redactLogUrl(url)).not.toContain(secret);
});

test("redacts signed URL signature query parameters", () => {
  const secret = "synthetic-signature-unique";
  const url = `https://storage.invalid/object?X-Amz-Signature=${secret}&X-Amz-Algorithm=AWS4-HMAC-SHA256`;
  expect(redactLogUrl(url)).not.toContain(secret);
  expect(redactLogUrl(url)).toContain("X-Amz-Algorithm=AWS4-HMAC-SHA256");
});

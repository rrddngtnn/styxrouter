import { expect, test } from "bun:test";
import { redactLogUrl } from "../src/lib/logUrlRedaction";
import { protectPayloadForLog } from "../src/lib/logPayloads";
import { getDbInstance } from "../src/lib/db/core";
import { startTestServer } from "./helpers/start-test-server";
import { stopTestProcess } from "./helpers/stop-test-process";

test("reviewed templates are case-sensitive and positional", () => {
  expect(redactLogUrl("/v1/chat/completions?model=visible")).toBe("/v1/chat/completions?model=visible");
  expect(redactLogUrl("/v1/models/chat")).toBe("/v1/models/[REDACTED]");
  expect(redactLogUrl("/v1/files/private/content")).toBe("/v1/files/[REDACTED]/content");
  expect(redactLogUrl("/unknown/chat/completions")).toBe("/[REDACTED]/[REDACTED]/[REDACTED]");
  expect(redactLogUrl("/V1/chat/completions")).toBe("/[REDACTED]/[REDACTED]/[REDACTED]");
});
for (const value of ["abc", "%73ecret", "tenant%2Fsecret", "%2573ecret", "%zz", "secret\\other"]) {
  test(`opaque path conceals ${value}`, () => {
    expect(redactLogUrl(`https://example.invalid/v1/chat/completions/${value}`)).not.toContain(value);
  });
}
test("ambiguous paths, nested and embedded URLs fail closed", () => {
  expect(redactLogUrl("/v1/chat/../secret")).not.toContain("secret");
  expect(redactLogUrl("//example.invalid/private/secret")).not.toContain("secret");
  expect(redactLogUrl("https://example.invalid\\secret")).not.toContain("secret");
  expect(redactLogUrl("/v1/%63hat/completions/secret")).not.toContain("secret");
  expect(redactLogUrl("failed (https://example.invalid/private/secret)." )).not.toContain("secret");
  expect(redactLogUrl("https://outer.invalid/?redirect=https%3A%2F%2Finner.invalid%2Fprivate%2Fsecret&model=visible")).not.toContain("secret");
  expect(JSON.stringify(protectPayloadForLog({ errors: ["https://example.invalid/private/secret"] }))).not.toContain("secret");
});
test("authenticated historical call-log reads redact paths without rewriting rows", async () => {
  const db = getDbInstance();
  const secret = "synthetic-opaque-historical-unique";
  const path = `/v1/chat/completions/${secret}?model=visible`;
  const payload = JSON.stringify({ endpoint: path, message: `failed https://example.invalid/private/${secret}` });
  db.prepare("INSERT INTO call_logs (id, timestamp, path, status, detail_state) VALUES (?, ?, ?, ?, ?)").run("opaque-http", new Date().toISOString(), path, 500, "none");
  db.prepare("INSERT INTO request_detail_logs (id, call_log_id, timestamp, translated_request) VALUES (?, ?, ?, ?)").run("opaque-detail", "opaque-http", new Date().toISOString(), payload);
  const password = "synthetic-opaque-password";
  const { proc, base } = await startTestServer(process.execPath, { cwd: `${import.meta.dir}/..`, env: { ...process.env, STYX_TEST_MODE: "1", INITIAL_PASSWORD: password, JWT_SECRET: "synthetic-opaque-jwt-0123456789", API_KEY_SECRET: "synthetic-opaque-key-0123456789" } });
  try {
    const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
    expect(cookie).not.toBe("");
    const response = await fetch(`${base}/api/usage/call-logs/opaque-http`, { headers: { cookie } });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain(secret);
    expect(text).toContain("model=visible");
    expect((db.prepare("SELECT path FROM call_logs WHERE id = ?").get("opaque-http") as any).path).toBe(path);
    expect((db.prepare("SELECT translated_request FROM request_detail_logs WHERE id = ?").get("opaque-detail") as any).translated_request).toBe(payload);
  } finally { await stopTestProcess(proc); }
}, 45000);

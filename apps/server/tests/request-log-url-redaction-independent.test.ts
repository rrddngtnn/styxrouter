import { expect, test } from "bun:test";
import { createRequestLogger } from "../open-sse/utils/requestLogger";
import { protectPayloadForLog } from "../src/lib/logPayloads";
import { getDbInstance } from "../src/lib/db/core";
import { getRequestDetailLogById, saveRequestDetailLog } from "../src/lib/db/detailedLogs";
import { startTestServer } from "./helpers/start-test-server";

test("request logs protect URL credentials and mixed-case secret headers without losing diagnostics", async () => {
  const secret = "synthetic-unique-credential-987654";
  const url = `https://user:${secret}@example.invalid/v1?model=test&api_key=${secret}&access_token=${secret}`;
  const logger = await createRequestLogger();
  logger.logClientRawRequest(`/v1?key=${secret}&model=test`, {}, { "X-Goog-Api-Key": secret, "X-Trace": "visible" });
  logger.logTargetRequest(url, { "Proxy-Authorization": secret, "X-Goog-Api-Key": secret }, {});
  logger.logProviderResponse(200, "OK", { "Set-Cookie": secret }, {});
  const pipeline = logger.getPipelinePayloads()!;
  expect(JSON.stringify(pipeline)).not.toContain(secret);
  expect(JSON.stringify(pipeline)).toContain("model=test");
  expect(JSON.stringify(pipeline)).toContain("visible");
  const stored = protectPayloadForLog({ providerRequest: { url, headers: { "X-Goog-Api-Key": secret, "Set-Cookie": secret, "X-Trace": "visible" } } });
  expect(JSON.stringify(stored)).not.toContain(secret);
  expect(JSON.stringify(stored)).toContain("visible");
});

test("stored and historical database details redact credentials without mutating historical rows", () => {
  const secret = "synthetic-database-secret-123456";
  const detail = { url: `https://example.invalid/?api_key=${secret}&model=ok`, headers: { "X-Goog-Api-Key": secret } };
  saveRequestDetailLog({ id: "new-redaction", translated_request: detail });
  const db = getDbInstance();
  const fresh: any = db.prepare("SELECT translated_request FROM request_detail_logs WHERE id = ?").get("new-redaction");
  expect(fresh.translated_request).not.toContain(secret);
  db.prepare("INSERT INTO request_detail_logs (id, timestamp, translated_request) VALUES (?, ?, ?)").run("historical-redaction", new Date().toISOString(), JSON.stringify(detail));
  expect(JSON.stringify(getRequestDetailLogById("historical-redaction"))).not.toContain(secret);
  const historical: any = db.prepare("SELECT translated_request FROM request_detail_logs WHERE id = ?").get("historical-redaction");
  expect(historical.translated_request).toContain(secret);
});

test("authenticated detail endpoint redacts a historical detail without modifying its row", async () => {
  const db = getDbInstance();
  const secret = "synthetic-http-secret-98765";
  const payload = JSON.stringify({ url: `https://example.invalid/?key=${secret}&model=ok`, headers: { "X-Goog-Api-Key": secret } });
  db.prepare("INSERT INTO call_logs (id, timestamp, path, status, detail_state) VALUES (?, ?, ?, ?, ?)").run("http-redaction", new Date().toISOString(), `/v1?key=${secret}`, 200, "none");
  db.prepare("INSERT INTO request_detail_logs (id, call_log_id, timestamp, translated_request) VALUES (?, ?, ?, ?)").run("http-detail", "http-redaction", new Date().toISOString(), payload);
  const password = "test-request-redaction-password";
  const { proc, base } = await startTestServer(process.execPath, { cwd: `${import.meta.dir}/..`, env: { ...process.env, STYX_TEST_MODE: "1", INITIAL_PASSWORD: password, JWT_SECRET: "test-request-redaction-jwt-0123456789", API_KEY_SECRET: "test-request-redaction-key-0123456789" } });
  try {
    const path = `${base}/api/usage/call-logs/http-redaction`;
    expect((await fetch(path)).status).toBe(401);
    const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
    expect(cookie).not.toBe("");
    const response = await fetch(path, { headers: { cookie } });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain(secret);
    expect(text).toContain("model=ok");
    expect((db.prepare("SELECT translated_request FROM request_detail_logs WHERE id = ?").get("http-detail") as any).translated_request).toBe(payload);
  } finally { proc.kill("SIGKILL"); }
}, 30000);

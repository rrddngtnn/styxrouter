import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startTestServer } from "./helpers/start-test-server";
import { stopTestProcess } from "./helpers/stop-test-process";

const password = "bulk-import-password-secret";
let proc: any, base: string, dataDir: string, cookie: string;
beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "bulk-redaction-"));
  ({ proc, base } = await startTestServer(process.execPath, { cwd: join(import.meta.dir, ".."), env: {
    ...process.env, DATA_DIR: dataDir, STYX_TEST_MODE: "1", STORAGE_ENCRYPTION_KEY: "0".repeat(64),
    JWT_SECRET: "bulk-redaction-jwt-secret-0123456789", INITIAL_PASSWORD: password,
  }}));
  const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
  expect(login.status).toBe(200);
  cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
}, 110000);
afterAll(async () => { await stopTestProcess(proc); if (dataDir) rmSync(dataDir, { recursive: true, force: true }); }, 10000);

test("provider rejection and created names cannot echo submitted keys", async () => {
  const secret = "synthetic-secret-unique-482731";
  const post = (payload: unknown) => fetch(`${base}/api/connections/bulk`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(payload) });
  const rejected = await post({ provider: secret, lines: [secret] });
  expect(rejected.status).toBe(400);
  expect(await rejected.text()).not.toContain(secret);
  const imported = await post({ provider: "openai", lines: [`${secret}|account-${secret}`, "synthetic-other-key|safe-name"] });
  expect(imported.status).toBe(201);
  const text = await imported.text();
  expect(text).not.toContain(secret);
  expect(JSON.parse(text).created[1].name).toBe("safe-name");
  const validation = await post({ provider: "openai", lines: [secret, 7] });
  expect(validation.status).toBe(400);
  expect(await validation.text()).not.toContain(secret);
  const crossEntry = await post({ provider: "openai", lines: [`different-synthetic-key|name-${secret}`, secret] });
  expect(crossEntry.status).toBe(201);
  expect(await crossEntry.text()).not.toContain(secret);
});

test("failed bulk key import never echoes the submitted credential", async () => {
  const res = await fetch(`${base}/api/connections/bulk`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ provider: "openai", lines: [password] }) });
  const text = await res.text();
  expect(res.status).toBe(201);
  expect(JSON.parse(text).skipped).toHaveLength(1);
  expect(text).not.toContain(password);
});

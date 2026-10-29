import { afterAll, beforeAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startTestServer } from "./helpers/start-test-server";

const root = join(import.meta.dir, "..");
const dir = mkdtempSync(join(tmpdir(), "import-expiry-"));
let proc: any, base = "", cookie = "", key = "";
const env = { ...process.env, DATA_DIR: dir, STYX_TEST_MODE: "1", JWT_SECRET: "import-expiry-jwt-secret-0123456789", API_KEY_SECRET: "import-expiry-api-secret-0123456789", STORAGE_ENCRYPTION_KEY: "import-expiry-encryption-key", INITIAL_PASSWORD: "import-expiry-password" };
beforeAll(async () => {
  const made = spawnSync(process.execPath, ["-e", "const {createApiKey}=await import('./src/lib/db/apiKeys.ts'); console.log((await createApiKey('import-expiry','test')).key)"], { cwd: root, env, encoding: "utf8" });
  expect(made.status).toBe(0);
  key = made.stdout.trim().split("\n").pop()!;
  ({ proc, base } = await startTestServer(process.execPath, { cwd: root, env }));
  const login = await fetch(base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "import-expiry-password" }) });
  cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
}, 30000);
afterAll(() => { proc?.kill("SIGKILL"); rmSync(dir, { recursive: true, force: true }); });

test("expired imported access-only credential is rejected before upstream without refresh or silent fallback", async () => {
  const imported = await fetch(base + "/api/connections/import", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ provider: "codebuddy-cn", accounts: { access_token: "synthetic-expired-token", expires_at: 1 } }) });
  expect((await imported.json() as any).results[0].valid).toBe(true);
  const r = await fetch(base + "/v1/chat/completions", { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ model: "codebuddy-cn/deepseek-v3.2", messages: [{ role: "user", content: "test" }] }) });
  expect(r.status).toBe(401);
  const text = await r.text();
  expect(text).toContain("Token expired; re-import or re-authenticate");
  expect(text).toContain("IMPORTED_TOKEN_REAUTH_REQUIRED");
  expect(text).not.toContain("synthetic-expired-token");
}, 30000);

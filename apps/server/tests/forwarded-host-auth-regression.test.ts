import { afterAll, beforeAll, expect, test } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startTestServer } from "./helpers/start-test-server";
import { stopTestProcess } from "./helpers/stop-test-process";

const root = join(import.meta.dir, "..");
const dir = mkdtempSync(join(tmpdir(), "styx-forwarded-host-"));
let app: ChildProcess;
let proxy: ChildProcess;
let direct = "";
let base = "";
let cookie = "";

beforeAll(async () => {
  ({ proc: app, base: direct } = await startTestServer(process.execPath, { cwd: root, env: { ...process.env, DATA_DIR: dir, JWT_SECRET: "test-forwarded-host-secret-32-bytes", INITIAL_PASSWORD: "test-password-123", STYX_TEST_MODE: "1" } }));
  const listener = createServer();
  await new Promise<void>(resolve => listener.listen(0, "127.0.0.1", resolve));
  const port = (listener.address() as { port: number }).port;
  await new Promise<void>(resolve => listener.close(() => resolve()));
  base = `http://127.0.0.1:${port}`;
  const config = join(dir, "Caddyfile");
  writeFileSync(config, `{\n admin off\n}\nhttp://127.0.0.1:${port} {\n @unsafe header X-Test-Unsafe yes\n handle @unsafe {\n  reverse_proxy ${new URL(direct).host} {\n   header_up X-Forwarded-Host {http.request.header.X-Forwarded-Host}\n  }\n }\n handle {\n  reverse_proxy ${new URL(direct).host}\n }\n}\n`);
  proxy = spawn("caddy", ["run", "--config", config, "--adapter", "caddyfile"], { stdio: "ignore" });
  const deadline = Date.now() + 15000;
  while (true) {
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {}
    if (Date.now() > deadline || proxy.exitCode !== null) throw new Error("Caddy test proxy failed to start");
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "test-password-123" }) });
  expect(login.status).toBe(200);
  cookie = login.headers.get("set-cookie")!.split(";")[0];
}, 40000);

afterAll(async () => { if (proxy) await stopTestProcess(proxy); if (app) await stopTestProcess(app); rmSync(dir, { recursive: true, force: true }); });

test("direct backend rejects forged forwarded host on real settings write", async () => {
  const r = await fetch(`${direct}/api/settings`, { method: "PATCH", headers: { cookie, origin: "https://evil.example", "x-forwarded-host": "evil.example", "content-type": "application/json" }, body: "{}" });
  expect(r.status).toBe(403);
});

test("default Caddy preserves the public host and rejects forged cross-origin requests", async () => {
  const headers = { cookie, "content-type": "application/json" };
  const same = await fetch(`${base}/api/settings`, { method: "PATCH", headers: { ...headers, origin: base }, body: "{}" });
  expect(same.status).toBe(200);
  const foreign = await fetch(`${base}/api/settings`, { method: "PATCH", headers: { ...headers, origin: "https://evil.example", "x-forwarded-host": "evil.example" }, body: "{}" });
  expect(foreign.status).toBe(403);
  const unsanitizedProxy = await fetch(`${base}/api/settings`, { method: "PATCH", headers: { ...headers, origin: "https://evil.example", "x-forwarded-host": "evil.example", "x-test-unsafe": "yes" }, body: "{}" });
  expect(unsanitizedProxy.status).toBe(403);
});

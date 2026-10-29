import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SignJWT } from "jose";
import { startTestServer } from "./helpers/start-test-server";
import { stopTestProcess } from "./helpers/stop-test-process";
import type { ChildProcess } from "node:child_process";

const dir = mkdtempSync(join(tmpdir(), "styx-auth-review-"));
const secret = "test-auth-review-secret-32-bytes-long";
const trustedOrigin = "https://router.example";
const processes: ChildProcess[] = [];
let base: string;
let defaultBase: string;
let invalidBase: string;
let cookie: string;
beforeAll(async () => {
  const env = { ...process.env, JWT_SECRET: secret, STYX_TEST_MODE: "1" };
  delete env.STYX_TRUSTED_PUBLIC_ORIGIN;
  async function start(name: string, origin?: string) {
    const server = await startTestServer(process.execPath, { cwd: join(import.meta.dir, ".."), env: { ...env, DATA_DIR: join(dir, name), ...(origin === undefined ? {} : { STYX_TRUSTED_PUBLIC_ORIGIN: origin }) } });
    processes.push(server.proc);
    return server.base;
  }
  base = await start("strict", trustedOrigin);
  defaultBase = await start("default");
  invalidBase = await start("invalid", "http://router.example");
  cookie = `auth_token=${await new SignJWT({ authenticated: true }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("1h").sign(new TextEncoder().encode(secret))}`;
}, 40000);
afterAll(async () => { for (const proc of processes) await stopTestProcess(proc); rmSync(dir, { recursive: true, force: true }); });

async function write(server: string, origin?: string, extra: Record<string, string> = {}) {
  return fetch(`${server}/api/settings`, { method: "PATCH", headers: { cookie, ...(origin === undefined ? {} : { origin }), "content-type": "application/json", ...extra }, body: "{}" });
}

test("configured trusted origin rejects same-host foreign scheme", async () => {
  expect((await write(base, trustedOrigin)).status).toBe(200);
  expect((await write(base, "http://router.example", { "x-forwarded-proto": "https" })).status).toBe(403);
});

test("foreign port is rejected while no Origin remains compatible", async () => {
  expect((await write(base, "https://router.example:1")).status).toBe(403);
  expect((await write(base)).status).toBe(200);
});

test("unset trusted origin retains host-only compatibility without trusting forwarded host", async () => {
  const target = new URL(defaultBase);
  target.protocol = "https:";
  expect((await write(defaultBase, target.origin)).status).toBe(200);
  expect((await write(defaultBase)).status).toBe(200);
  expect((await write(defaultBase, "https://evil.example", { "x-forwarded-host": "evil.example" })).status).toBe(403);
});

test("invalid trusted origin fails closed even without Origin", async () => {
  expect((await write(invalidBase)).status).toBe(403);
  expect((await write(invalidBase, "http://router.example")).status).toBe(403);
});

test("authenticated metadata GET is not denied by spoofed forwarded host", async () => {
  const response = await fetch(`${defaultBase}/api/model-metadata?provider=openai&modelId=example`, { headers: { cookie, origin: defaultBase, "x-forwarded-host": "evil.example" } });
  expect(response.status).toBe(200);
});
import { afterAll, beforeAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startTestServer } from "./helpers/start-test-server";

const ROOT = join(import.meta.dir, "..");
let BASE = "", proc: any = null, dataDir = "", apiKey = "";
const env = () => ({ ...process.env, DATA_DIR: dataDir, STYX_TEST_MODE: "1", JWT_SECRET: "cc-json-jwt-secret-0123456789abcdef0123", API_KEY_SECRET: "cc-json-api-key-secret-0123456789abcdef" });

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "styx-ccjson-"));
  const made = spawnSync(process.execPath, ["-e", "const { createApiKey } = await import('./src/lib/db/apiKeys.ts'); console.log((await createApiKey('cc-test', 'test-machine')).key)"], { cwd: ROOT, env: env(), encoding: "utf8" });
  apiKey = (made.stdout || "").trim().split("\n").pop() || "";
  ({ proc, base: BASE } = await startTestServer(process.execPath, { cwd: ROOT, env: env() }));
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 300)); }
}, 60000);
afterAll(() => { proc?.kill("SIGKILL"); if (dataDir) rmSync(dataDir, { recursive: true, force: true }); });

test("/v1/chat/completions rejects malformed JSON with 400, not 500", async () => {
  const r = await fetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: "{not json",
  });
  expect(r.status).toBe(400);
  expect(((await r.json()) as any).error).toBeTruthy();
});

import { startTestServer } from "./helpers/start-test-server";
/**
 * /v1 surface: besides /v1/chat/completions, Anthropic clients (POST /v1/messages) and Codex-style
 * clients (POST /v1/responses) are routed through the same key gate and the same dispatcher.
 * Boots a REAL server on a throwaway DATA_DIR. A request for an unknown model proves the route reaches
 * the dispatcher: it answers with a JSON error from it, not the framework's plain-text 404.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
let BASE = "";
const BUN = process.execPath;

let proc: ReturnType<typeof spawn> | null = null;
let dataDir = "";
let apiKey = "";

const env = () => ({
  ...process.env,

  DATA_DIR: dataDir,
  STYX_TEST_MODE: "1",
  JWT_SECRET: "v1-surface-jwt-secret-0123456789abcdef0123456789",
  API_KEY_SECRET: "v1-surface-api-key-secret-0123456789abcdef",
});

async function waitReady() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("styx test boot timed out");
}

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const authed = () => ({ authorization: `Bearer ${apiKey}` });

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "styx-v1-"));
  const made = spawnSync(
    BUN,
    ["-e", "const { createApiKey } = await import('./src/lib/db/apiKeys.ts'); console.log((await createApiKey('v1-test', 'test-machine')).key)"],
    { cwd: ROOT, env: env(), encoding: "utf8" }
  );
  apiKey = (made.stdout || "").trim().split("\n").pop() || "";
  ({ proc, base: BASE } = await startTestServer(BUN, { cwd: ROOT, env: env() }));
  await waitReady();
});

afterAll(() => {
  proc?.kill("SIGKILL");
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

const anthropicBody = { model: "no-such-provider/no-such-model", max_tokens: 8, messages: [{ role: "user", content: "hi" }] };
const responsesBody = { model: "no-such-provider/no-such-model", input: "hi" };

describe.each([
  ["/v1/messages", anthropicBody],
  ["/v1/responses", responsesBody],
])("%s", (path, body) => {
  test("needs an API key", async () => {
    expect((await post(path, body)).status).toBe(401);
    expect((await post(path, body, { authorization: "Bearer sk-bogus-0000000000000000" })).status).toBe(401);
  });

  test("is routed to the dispatcher (JSON error for an unknown model, not a framework 404)", async () => {
    const r = await post(path, body, authed());
    expect(r.headers.get("content-type") ?? "").toMatch(/application\/json/);
    const j: any = await r.json();
    expect(j.error).toBeTruthy();
    expect(r.status).not.toBe(200);
  });

  test("rejects a body that is not JSON with 400", async () => {
    const r = await post(path, "{not json", authed());
    expect(r.status).toBe(400);
    expect(((await r.json()) as any).error).toBeTruthy();
  });
});

describe("/v1/messages/count_tokens", () => {
  const body = { model: "no-such-provider/no-such-model", messages: [{ role: "user", content: "hello there, how many tokens am I?" }], system: "be brief" };

  test("needs an API key", async () => {
    expect((await post("/v1/messages/count_tokens", body)).status).toBe(401);
  });

  test("falls back to a local estimate for a model it cannot reach", async () => {
    const r = await post("/v1/messages/count_tokens", body, authed());
    expect(r.status).toBe(200);
    const j: any = await r.json();
    expect(j.source).toBe("local");
    expect(j.input_tokens).toBeGreaterThan(3);
  });

  test("rejects a body that is not JSON with 400", async () => {
    expect((await post("/v1/messages/count_tokens", "{nope", authed())).status).toBe(400);
  });
});

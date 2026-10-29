import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startTestServer } from "./helpers/start-test-server";

let base = "", cookie = "", dir = "";
let proc: any;
const password = "provider-model-capability-fixture";
const request = (method: string, path: string, body?: unknown) => fetch(base + path, { method, headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "provider-capability-"));
  ({ proc, base } = await startTestServer(process.execPath, { cwd: join(import.meta.dir, ".."), env: { ...process.env, DATA_DIR: dir, STYX_TEST_MODE: "1", JWT_SECRET: "fixture-jwt-secret-0123456789012345", API_KEY_SECRET: "fixture-key-secret-0123456789012345", INITIAL_PASSWORD: password } }));
  const login = await fetch(base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
  expect(login.status).toBe(200);
  cookie = (login.headers.get("set-cookie") || "").split(";")[0];
}, 60000);
afterAll(async () => { if (proc) { proc.kill("SIGKILL"); await proc.exited; } if (dir) rmSync(dir, { recursive: true, force: true }); });

test("manual model limits and vision can be created, edited, cleared and validated", async () => {
  const path = "/api/providers/openai/models";
  const create = await request("POST", path, { id: "fixture-capabilities", inputTokenLimit: 4096, outputTokenLimit: 1024, supportsVision: false });
  expect(create.status).toBe(201);
  expect(await create.json()).toMatchObject({ inputTokenLimit: 4096, outputTokenLimit: 1024, supportsVision: false });
  const target = path + "/fixture-capabilities";
  const update = await request("PATCH", target, { inputTokenLimit: 8192, supportsVision: true });
  expect(update.status).toBe(200);
  expect(await update.json()).toMatchObject({ inputTokenLimit: 8192, outputTokenLimit: 1024, supportsVision: true });
  for (const body of [{ inputTokenLimit: 0 }, { outputTokenLimit: -1 }, { inputTokenLimit: 1.5 }, { supportsVision: "yes" }]) expect((await request("PATCH", target, body)).status).toBe(400);
  const clear = await request("PATCH", target, { inputTokenLimit: null, outputTokenLimit: null, supportsVision: null });
  expect(clear.status).toBe(200);
  const model: any = (await (await request("GET", path)).json()).models.find((m: any) => m.id === "fixture-capabilities");
  expect(model.inputTokenLimit).toBeUndefined();
  expect(model.outputTokenLimit).toBeUndefined();
  expect(model.supportsVision).toBeUndefined();
}, 30000);

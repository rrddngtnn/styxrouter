import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { startTestServer } from "./helpers/start-test-server";
import { stopTestProcess } from "./helpers/stop-test-process";

let base = "", cookie = "", dir = "", proc: any;
const request = (method: string, path: string, body?: unknown) => fetch(base + path, { method, headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "provider-specialty-"));
  ({ proc, base } = await startTestServer(process.execPath, { cwd: join(import.meta.dir, ".."), env: { ...process.env, DATA_DIR: dir, STYX_TEST_MODE: "1", JWT_SECRET: "specialty-jwt-secret-0123456789", API_KEY_SECRET: "specialty-key-secret-0123456789", INITIAL_PASSWORD: "specialty-password" } }));
  const login = await fetch(base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "specialty-password" }) });
  expect(login.status).toBe(200); cookie = (login.headers.get("set-cookie") || "").split(";")[0];
}, 60000);
afterAll(async () => { await stopTestProcess(proc); if (dir) rmSync(dir, { recursive: true, force: true }); });

test("provider inventory lists specialty rows and rejects duplicate manual creation without confusing compatible nodes", async () => {
  const path = "/api/providers/openai/models";
  expect((await fetch(base + path)).status).toBe(401);
  const body: any = await (await request("GET", path)).json();
  expect(body.providerId).toBe("openai");
  expect(body.models.find((m: any) => m.id === "text-embedding-3-small")).toMatchObject({ origin: "embedding-registry", type: "embedding" });
  const specialty = body.models.find((m: any) => m.origin === "image-registry");
  expect(specialty.type).toBe("image");
  expect((await request("POST", path, { id: "text-embedding-3-small" })).status).toBe(409);
  expect((await request("POST", path, { id: specialty.id })).status).toBe(409);
  const created: any = await (await request("POST", "/api/provider-nodes", { type: "openai-compatible", name: "Fixture", prefix: "specialtyfixture", apiType: "chat", baseUrl: "https://example.com" })).json();
  const nodePath = `/api/providers/${created.node.id}/models`;
  const node: any = await (await request("GET", nodePath)).json();
  expect(node.models.some((m: any) => m.id === "text-embedding-3-small")).toBe(false);
  expect((await request("POST", nodePath, { id: "text-embedding-3-small" })).status).toBe(201);
}, 60000);

test("legacy manual specialty model with provider-like local prefix remains editable and removable", async () => {
  const db = new Database(join(dir, "storage.sqlite"));
  db.query("INSERT INTO key_value(namespace,key,value) VALUES('customModels',?,?) ON CONFLICT(namespace,key) DO UPDATE SET value=excluded.value").run("openrouter", JSON.stringify([{ id: "openai/whisper-1", name: "Legacy", source: "manual" }]));
  db.close();
  const path = "/api/providers/openrouter/models/" + encodeURIComponent("openai/whisper-1");
  expect((await request("PATCH", path, { name: "Edited legacy" })).status).toBe(200);
  expect((await request("DELETE", path)).status).toBe(200);
  const after: any = await (await request("GET", "/api/providers/openrouter/models")).json();
  expect(after.models.find((m: any) => m.id === "openai/whisper-1")).toMatchObject({ origin: "audio-registry", type: "audio" });
});

test("preexisting manual collision remains visible and removable, revealing registry row", async () => {
  const db = new Database(join(dir, "storage.sqlite"));
  db.query("INSERT INTO key_value(namespace,key,value) VALUES('customModels',?,?) ON CONFLICT(namespace,key) DO UPDATE SET value=excluded.value").run("openai", JSON.stringify([{ id: "text-embedding-3-large", name: "Legacy manual", source: "manual" }]));
  db.close();
  const path = "/api/providers/openai/models";
  const before: any = await (await request("GET", path)).json();
  expect(before.models.filter((m: any) => m.id === "text-embedding-3-large")).toEqual([expect.objectContaining({ origin: "manual", name: "Legacy manual" })]);
  expect((await request("DELETE", path + "/text-embedding-3-large")).status).toBe(200);
  const after: any = await (await request("GET", path)).json();
  expect(after.models.find((m: any) => m.id === "text-embedding-3-large")).toMatchObject({ origin: "embedding-registry", type: "embedding" });
});

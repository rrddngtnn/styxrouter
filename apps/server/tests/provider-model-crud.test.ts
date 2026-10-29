import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startTestServer } from "./helpers/start-test-server";
import { Database } from "bun:sqlite";

let base = "", cookie = "", dir = "";
let proc: any;
const password = "provider-model-test-password";
const request = (method: string, path: string, body?: unknown, extra: Record<string, string> = {}) => fetch(base + path, { method, headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "provider-model-crud-"));
  ({ proc, base } = await startTestServer(process.execPath, { cwd: join(import.meta.dir, ".."), env: { ...process.env, DATA_DIR: dir, STYX_TEST_MODE: "1", JWT_SECRET: "provider-model-jwt-secret-0123456789", API_KEY_SECRET: "provider-model-key-secret-0123456789", INITIAL_PASSWORD: password } }));
  const login = await fetch(base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
  expect(login.status).toBe(200);
  cookie = (login.headers.get("set-cookie") || "").split(";")[0];
}, 60000);
afterAll(() => { proc?.kill("SIGKILL"); if (dir) rmSync(dir, { recursive: true, force: true }); });

test("provider manual model lifecycle is authenticated and listed with origin", async () => {
  const path = "/api/providers/openai/models";
  expect((await fetch(base + path)).status).toBe(401);
  expect((await request("POST", path, { id: "custom-lifecycle" }, { origin: "https://foreign.example" })).status).toBe(403);
  const before: any = await (await request("GET", path)).json();
  expect(before.models.some((m: any) => m.origin === "built-in")).toBe(true);
  expect((await request("POST", path, { id: "custom-lifecycle", name: "First" })).status).toBe(201);
  expect((await request("POST", path, { id: "custom-lifecycle" })).status).toBe(409);
  expect((await request("PATCH", path + "/custom-lifecycle", { name: "Edited" })).status).toBe(200);
  const listed: any = await (await request("GET", path)).json();
  expect(listed.models.find((m: any) => m.id === "custom-lifecycle")).toMatchObject({ name: "Edited", origin: "manual" });
  expect((await request("DELETE", path + "/custom-lifecycle")).status).toBe(200);
  const after: any = await (await request("GET", path)).json();
  expect(after.models.some((m: any) => m.id === "custom-lifecycle")).toBe(false);
});

test("manual model changes immediately refresh the served catalog", async () => {
  const path = "/api/providers/openai/models";
  const connection = await request("POST", "/api/connections", { provider: "openai", apiKey: "fixture-key", name: "Fixture" });
  expect(connection.status).toBe(201);
  const catalog = async () => (await (await request("GET", "/v1/models")).json()) as any;
  await catalog();
  expect((await request("POST", path, { id: "catalog-refresh-model", name: "Before" })).status).toBe(201);
  expect((await catalog()).data.some((m: any) => m.id === "openai/catalog-refresh-model")).toBe(true);
  expect((await request("PATCH", path + "/catalog-refresh-model", { apiFormat: "embeddings", supportedEndpoints: ["embeddings"] })).status).toBe(200);
  expect((await catalog()).data.find((m: any) => m.id === "openai/catalog-refresh-model")?.type).toBe("embedding");
  expect((await request("DELETE", path + "/catalog-refresh-model")).status).toBe(200);
  expect((await catalog()).data.some((m: any) => m.id === "openai/catalog-refresh-model")).toBe(false);
}, 30000);

test("catalog invalidation crosses server processes", async () => {
  const second = await startTestServer(process.execPath, { cwd: join(import.meta.dir, ".."), env: { ...process.env, DATA_DIR: dir, STYX_TEST_MODE: "1", JWT_SECRET: "provider-model-jwt-secret-0123456789", API_KEY_SECRET: "provider-model-key-secret-0123456789", INITIAL_PASSWORD: password } });
  try {
    const competing = await Promise.all([request("POST", "/api/providers/openai/models", { id: "cross-race" }), fetch(second.base + "/api/providers/openai/models", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ id: "cross-race" }) })]);
    expect(competing.map(r => r.status).sort()).toEqual([201, 409]);
    for (let i = 0; i < 15; i++) {
      const one = `race-left-${i}`, two = `race-right-${i}`;
      const results = await Promise.all([request("POST", "/api/providers/openai/models", { id: one }), fetch(second.base + "/api/providers/openai/models", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ id: two }) })]);
      expect(results.map(r => r.status)).toEqual([201, 201]);
      const rows: any = await (await request("GET", "/api/providers/openai/models")).json();
      expect(rows.models.some((m: any) => m.id === one)).toBe(true);
      expect(rows.models.some((m: any) => m.id === two)).toBe(true);
    }
    const read = async () => (await (await fetch(second.base + "/v1/models", { headers: { cookie } })).json()) as any;
    await read();
    expect((await request("POST", "/api/providers/openai/models", { id: "cross-process-model" })).status).toBe(201);
    expect((await read()).data.some((m: any) => m.id === "openai/cross-process-model")).toBe(true);
    expect((await request("PATCH", "/api/providers/openai/models/cross-process-model", { apiFormat: "embeddings", supportedEndpoints: ["embeddings"] })).status).toBe(200);
    expect((await read()).data.find((m: any) => m.id === "openai/cross-process-model")?.type).toBe("embedding");
    expect((await request("DELETE", "/api/providers/openai/models/cross-process-model")).status).toBe(200);
    expect((await read()).data.some((m: any) => m.id === "openai/cross-process-model")).toBe(false);
  } finally { second.proc.kill("SIGKILL"); }
}, 60000);

test("simultaneous duplicate adds have one winner", async () => {
  const path = "/api/providers/openai/models";
  const results = await Promise.all(Array.from({ length: 8 }, () => request("POST", path, { id: "racing-model" })));
  expect(results.map(r => r.status).sort()).toEqual([201, 409, 409, 409, 409, 409, 409, 409]);
});

test("validation, collisions, and node identities protect built-in and synced inventory", async () => {
  const path = "/api/providers/openai/models";
  const list: any = await (await request("GET", path)).json();
  const builtin = list.models.find((m: any) => m.origin === "built-in").id;
  expect((await request("POST", path, { id: builtin })).status).toBe(409);
  expect((await request("DELETE", path + "/" + encodeURIComponent(builtin))).status).toBe(409);
  for (const id of ["", " open", "openai/other", "codex/other", "../x", "x//y", "x?y"]) {
    expect((await request("POST", path, { id })).status).toBe(400);
  }
  for (const body of [{ id: "valid", source: "auto-sync" }, { id: "valid", apiFormat: "evil" }, { id: "valid", supportedEndpoints: ["evil"] }, { id: "valid", targetFormat: "evil" }]) {
    expect((await request("POST", path, body)).status).toBe(400);
  }
  expect((await request("GET", "/api/providers/not-a-provider/models")).status).toBe(404);
  const created: any = await (await request("POST", "/api/provider-nodes", { type: "openai-compatible", name: "Fixture", prefix: "fixturemodel", apiType: "chat", baseUrl: "https://example.com" })).json();
  const node = created.node.id;
  const nodePath = `/api/providers/${node}/models`;
  const db = new Database(join(dir, "storage.sqlite"));
  db.query("INSERT INTO key_value(namespace,key,value) VALUES('syncedAvailableModels',?,?)").run(`${node}:fixture`, JSON.stringify([{ id: "vendor/synced", name: "Synced" }]));
  db.close();
  const nodeList: any = await (await request("GET", nodePath)).json();
  expect(nodeList).toMatchObject({ providerId: node, prefix: "fixturemodel" });
  expect(nodeList.models.find((m: any) => m.id === "vendor/synced")).toMatchObject({ origin: "synced" });
  expect((await request("POST", nodePath, { id: "vendor/synced" })).status).toBe(409);
  expect((await request("DELETE", nodePath + "/" + encodeURIComponent("vendor/synced"))).status).toBe(409);
  expect((await request("POST", nodePath, { id: "vendor/custom" })).status).toBe(201);
  expect((await request("PATCH", nodePath + "/" + encodeURIComponent("vendor/custom"), { name: "New" })).status).toBe(200);
  expect((await request("DELETE", nodePath + "/" + encodeURIComponent("vendor/custom"))).status).toBe(200);
});

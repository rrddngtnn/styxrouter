import { afterAll, beforeAll, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startTestServer } from "./helpers/start-test-server";
import * as providerCatalog from "../server/providerModels.ts";

let base = "", cookie = "", dir = "", proc: any;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "scoped-catalog-"));
  ({proc, base} = await startTestServer(process.execPath, {cwd: join(import.meta.dir, ".."), env: {...process.env, DATA_DIR: dir, STYX_TEST_MODE: "1", JWT_SECRET: "scoped-catalog-secret-0123456789", API_KEY_SECRET: "scoped-key-secret-0123456789", INITIAL_PASSWORD: "scoped-password"}}));
  const login = await fetch(base + "/api/auth/login", {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({password: "scoped-password"})});
  expect(login.status).toBe(200); cookie = (login.headers.get("set-cookie") || "").split(";")[0];
}, 60000);
afterAll(() => { proc?.kill("SIGKILL"); if (dir) rmSync(dir, {recursive: true, force: true}); });

test("same public ID retains exact provider and node identities", () => {
  const rows = (providerCatalog as any).buildScopedInventoryRows([{providerId: "alpha", nodeId: null, prefix: "shared", models: [{id: "vendor/model", origin: "manual"}]}, {providerId: "node-uuid", nodeId: "node-uuid", prefix: "shared", models: [{id: "vendor/model", origin: "synced"}]}]);
  expect(rows).toHaveLength(2);
  expect(rows.map(r => [r.id, r.providerId, r.nodeId, r.localId])).toEqual([["shared/vendor/model", "alpha", null, "vendor/model"], ["shared/vendor/model", "node-uuid", "node-uuid", "vendor/model"]]);
});

test("alias targets and generated effort preserve identity and avoid ambiguous prefixes and collisions", () => {
  const inventories: any[] = [
    {providerId: "alpha", nodeId: null, prefix: "alpha", models: [{id: "vendor/model", origin: "synced", supportedThinkingEfforts: ["high", "low"]}, {id: "vendor/model-high", origin: "built-in"}]},
    {providerId: "node", nodeId: "node", prefix: "shared", models: []},
  ];
  providerCatalog.expandAdminInventories(inventories, {a: "alpha/vendor/alias-model", b: "shared/ambiguous", c: "unknown/model"}, new Map([["alpha", ["alpha"]], ["shared", ["alpha", "node"]]]));
  const rows = providerCatalog.buildScopedInventoryRows(inventories);
  expect(rows.find(r => r.localId === "vendor/alias-model")).toMatchObject({providerId: "alpha", nodeId: null, origin: "alias-backed"});
  expect(rows.find(r => r.localId === "vendor/model-low")).toMatchObject({providerId: "alpha", origin: "generated-effort", baseLocalId: "vendor/model"});
  expect(rows.filter(r => r.localId === "vendor/model-high")).toHaveLength(1);
  expect(rows.some(r => r.localId === "ambiguous")).toBe(false);
});

test("malformed synced inventory does not break the admin catalog", async () => {
  const db = new Database(join(dir, "storage.sqlite"));
  db.query("INSERT OR REPLACE INTO key_value(namespace,key,value) VALUES('syncedAvailableModels',?,?)").run("openai:bad", "not-json");
  db.close();
  try {
    const res = await fetch(base + "/api/admin/provider-catalog", {headers: {cookie}});
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.coverage.complete).toBe(false);
    expect(body.coverage.malformedSyncedProviders).toContain("openai");
    expect((await fetch(base + "/api/providers/openai/models", {headers: {cookie}})).status).toBe(500);
    expect(body.data.some((row: any) => row.providerId === "openai")).toBe(true);
  } finally {
    const cleanup = new Database(join(dir, "storage.sqlite"));
    cleanup.query("DELETE FROM key_value WHERE namespace='syncedAvailableModels' AND key=?").run("openai:bad");
    cleanup.close();
  }
});

test("inventory endpoint requires a dashboard session and reports its limited scope", async () => {
  expect((await fetch(base + "/api/admin/provider-catalog")).status).toBe(401);
  expect((await fetch(base + "/api/admin/provider-catalog", {headers: {authorization: "Bearer invalid"}})).status).toBe(401);
  const res = await fetch(base + "/api/admin/provider-catalog", {headers: {cookie}});
  expect(res.status).toBe(200);
  const body: any = await res.json();
  expect(body.coverage.complete).toBe(false);
  expect(body.coverage.sources).toEqual(["provider-inventory", "embedding-registry", "image-registry", "rerank-registry", "audio-registry", "moderation-registry", "video-registry", "music-registry", "alias-backed-targets", "generated-effort"]);
  for (const [origin, type] of Object.entries({"embedding-registry":"embedding", "image-registry":"image", "rerank-registry":"rerank", "audio-registry":"audio", "moderation-registry":"moderation", "video-registry":"video", "music-registry":"music"})) {
    const rows = body.data.filter((row: any) => row.origin === origin);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row: any) => row.type === type)).toBe(true);
  }
  expect(body.data.some((row: any) => row.providerId === "openai" && row.localId === "text-embedding-3-small" && row.origin === "embedding-registry")).toBe(true);
  expect(body.data.some((row: any) => row.providerId === "openai" && row.nodeId === null && row.localId && row.id)).toBe(true);
}, 60000);

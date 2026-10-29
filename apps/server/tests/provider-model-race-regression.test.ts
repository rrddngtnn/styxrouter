import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { getDbInstance } from "../src/lib/db/core";
import { createProviderModelsApi } from "../server/providerModels";

const db = getDbInstance();
const provider = "openai";
function writeModels(models: unknown[]) {
  db.prepare("INSERT OR REPLACE INTO key_value(namespace,key,value) VALUES('customModels',?,?)").run(provider, JSON.stringify(models));
}
function models(): any[] {
  const row = db.prepare("SELECT value FROM key_value WHERE namespace='customModels' AND key=?").get(provider) as any;
  return row ? JSON.parse(row.value) : [];
}
async function worker(operation: string, id: string, underLock: () => void) {
  const child = spawn(process.execPath, [new URL("./helpers/provider-model-race-worker.ts", import.meta.url).pathname], { cwd: process.cwd(), env: process.env, stdio: ["pipe", "pipe", "pipe"] });
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  let errors = "";
  child.stderr.on("data", chunk => errors += chunk);
  async function waitFor(prefix: string) {
    while (true) {
      const line = await lines.next();
      if (line.done) throw new Error(`Worker exited waiting for ${prefix}: ${errors}`);
      if (line.value.startsWith(prefix)) return line.value.slice(prefix.length);
    }
  }
  try {
    await waitFor("RACE_READY");
    db.exec("BEGIN IMMEDIATE");
    child.stdin.end(JSON.stringify({ operation, provider, id }) + "\n");
    try {
      await waitFor("RACE_ATTEMPT");
      underLock();
    } finally { db.exec("COMMIT"); }
    const result = JSON.parse(await waitFor("RACE_RESULT:"));
    expect(await new Promise(resolve => child.on("exit", resolve))).toBe(0);
    return result;
  } finally { child.kill(); }
}

test("edit reads current list only after acquiring cross-process write lock", async () => {
  writeModels([{ id: "edit-target", source: "manual", name: "Before" }]);
  const result = await worker("edit", "edit-target", () => writeModels([{ id: "edit-target", source: "manual", name: "Before" }, { id: "concurrent", source: "manual" }]));
  expect(result.status).toBe(200);
  expect(models().map(m => m.id).sort()).toEqual(["concurrent", "edit-target"]);
}, 30000);

for (const operation of ["delete", "replace"] as const) {
  test(`${operation} preserves rows committed before the lock`, async () => {
    writeModels([{ id: "target", source: "manual", name: "Original" }]);
    const result = await worker(operation, "target", () => writeModels([{ id: "target", source: "manual", name: "Original" }, { id: "concurrent", source: "manual" }]));
    expect(result.status).toBe(200);
    expect(models().some(m => m.id === "concurrent")).toBe(true);
    if (operation === "replace") expect(models()).toContainEqual({ id: "target", source: "manual", name: "Original" });
  }, 30000);
}

for (const operation of ["edit", "delete"] as const) {
  test(`${operation} rejects origin changed while waiting for the lock`, async () => {
    writeModels([{ id: "target", source: "manual", name: "Original" }]);
    const result = await worker(operation, "target", () => writeModels([{ id: "target", source: "auto-sync", name: "New discovery" }]));
    expect(result.status).toBe(409);
    expect(models()).toEqual([{ id: "target", source: "auto-sync", name: "New discovery" }]);
  }, 30000);
  test(`${operation} returns 404 if removed while waiting for the lock`, async () => {
    writeModels([{ id: "target", source: "manual" }]);
    const result = await worker(operation, "target", () => writeModels([]));
    expect(result.status).toBe(404);
    expect(models()).toEqual([]);
  }, 30000);
  test(`${operation} rejects synced collision published while waiting`, async () => {
    writeModels([{ id: "target", source: "manual" }]);
    const result = await worker(operation, "target", () => db.prepare("INSERT OR REPLACE INTO key_value(namespace,key,value) VALUES('syncedAvailableModels',?,?)").run(`${provider}:race`, JSON.stringify([{ id: "target" }])));
    expect(result.status).toBe(409);
    expect(models()).toEqual([{ id: "target", source: "manual" }]);
    db.prepare("DELETE FROM key_value WHERE namespace='syncedAvailableModels' AND key=?").run(`${provider}:race`);
  }, 30000);
}

test("import cleanup preserves a manual row committed before the lock", async () => {
  writeModels([{ id: "imported", source: "auto-sync" }]);
  const result = await worker("cleanup", "unused", () => writeModels([{ id: "imported", source: "auto-sync" }, { id: "concurrent", source: "manual" }]));
  expect(result.status).toBe(200);
  expect(models()).toEqual([{ id: "concurrent", source: "manual" }]);
}, 30000);

test("malformed synced inventory fails closed for list and writes", async () => {
  const key = `${provider}:bad`;
  db.prepare("INSERT OR REPLACE INTO key_value(namespace,key,value) VALUES('syncedAvailableModels',?,?)").run(key, "{}");
  writeModels([{ id: "target", source: "manual" }]);
  try {
    const api = createProviderModelsApi();
    for (const [method, path, body] of [
      ["GET", "/providers/openai/models", undefined],
      ["POST", "/providers/openai/models", { id: "fresh" }],
      ["PATCH", "/providers/openai/models/target", { name: "New" }],
      ["DELETE", "/providers/openai/models/target", undefined],
    ] as const) {
      const res = await api.request(path, { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
      expect(res.status).toBe(500);
    }
    expect(models()).toEqual([{ id: "target", source: "manual" }]);
  } finally { db.prepare("DELETE FROM key_value WHERE namespace='syncedAvailableModels' AND key=?").run(key); }
});

test("create rejects synced collision published while waiting", async () => {
  writeModels([]);
  const result = await worker("create", "target", () => db.prepare("INSERT OR REPLACE INTO key_value(namespace,key,value) VALUES('syncedAvailableModels',?,?)").run(`${provider}:race`, JSON.stringify([{ id: "target" }])));
  expect(result.status).toBe(409);
  expect(models()).toEqual([]);
  db.prepare("DELETE FROM key_value WHERE namespace='syncedAvailableModels' AND key=?").run(`${provider}:race`);
}, 30000);

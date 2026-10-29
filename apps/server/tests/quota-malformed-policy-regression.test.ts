import { expect, test } from "bun:test";
import { createApiKey, getApiKeyMetadata, getApiKeyById, getApiKeys, updateApiKeyPermissions } from "../src/lib/db/apiKeys";
import { parseAllowedQuotas } from "../src/lib/db/apiKeys/rowParsers";
import { getDbInstance, SQLITE_FILE } from "../src/lib/db/core";
import { createProviderConnection } from "../src/lib/db/providers";
import { createPool, deletePool, updatePool } from "../src/lib/db/quotaPools";
import { createGroup } from "../src/lib/db/quotaGroups";
import { syncQuotaCombos } from "../src/lib/quota/quotaCombos";
import { getUnifiedModelsResponse } from "../src/app/api/v1/models/catalog";
import { updateSettings } from "../src/lib/db/settings";
import { enforceApiKeyPolicy } from "../src/shared/utils/apiKeyPolicy";

async function catalog(key: string) {
  return getUnifiedModelsResponse(new Request("http://localhost/v1/models", { headers: { authorization: `Bearer ${key}` } }));
}

test("corrupt persisted quota policy cannot expand a primed real catalog or authorize a request", async () => {
  await updateSettings({ hideAutoCombos: true, hideNoThinkVariants: true });
  const key = await createApiKey("malformed quota", "test");
  const connection = await createProviderConnection({ provider: "openai", authType: "apikey", apiKey: "fixture" } as any);
  const group = createGroup("malformed quota");
  const pool = createPool({ connectionId: connection.id, groupId: group.id, name: "test", exclusive: true,
    allocations: [{ apiKeyId: key.id, weight: 100, policy: "hard" }] });
  await syncQuotaCombos(pool.id);
  const before = await catalog(key.key);
  expect(before.status).toBe(200);
  const models = (await before.json() as { data: { id: string }[] }).data;
  expect(models.length).toBeGreaterThan(0);
  expect(models.every(model => model.id.startsWith("qtSd/"))).toBe(true);
  const child = Bun.spawnSync([process.execPath, "-e", `
    const { Database } = require("bun:sqlite");
    const db = new Database(process.argv[1]);
    db.run("UPDATE api_keys SET allowed_quotas = ? WHERE id = ?", ["{bad json", process.argv[2]]);
    db.close();
  `, SQLITE_FILE!, key.id], { env: process.env, stdout: "pipe", stderr: "pipe" });
  expect(child.exitCode).toBe(0);
  expect(new TextDecoder().decode(child.stderr)).toBe("");
  const after = await catalog(key.key);
  expect(after.status).toBeGreaterThanOrEqual(400);
  const request = new Request("http://localhost/v1/chat/completions", { headers: { authorization: `Bearer ${key.key}` } });
  expect((await enforceApiKeyPolicy(request, "openai/gpt-4o")).rejection?.status).toBeGreaterThanOrEqual(400);
  await expect(getApiKeyMetadata(key.key)).rejects.toThrow();
  getDbInstance().prepare("UPDATE api_keys SET allowed_quotas = '[]' WHERE id = ?").run(key.id);
});

test("persisted quota schema is an array of strings, including the intentional empty array", () => {
  expect(parseAllowedQuotas("[]")).toEqual([]);
  expect(parseAllowedQuotas(' ["pool", "legacy-id"] ')).toEqual(["pool", "legacy-id"]);
  for (const bad of ["", "  ", "{bad", "{}", "null", '"pool"', "123", "[null]", '["pool", 1]', "[{}]"])
    expect(() => parseAllowedQuotas(bad)).toThrow();
  for (const bad of [null, undefined, [], 1]) expect(() => parseAllowedQuotas(bad)).toThrow();
});

test("malformed persisted JSON fails closed across key views and request authorization", async () => {
  const key = await createApiKey("malformed matrix", "test");
  const db = getDbInstance();
  const update = db.prepare("UPDATE api_keys SET allowed_quotas = ? WHERE id = ?");
  const request = new Request("http://localhost/v1/chat/completions", { headers: { authorization: `Bearer ${key.key}` } });
  try {
    for (const bad of ["{bad", "{}", "null", '"pool"', "[1]", '["valid",null]', ""]) {
      update.run(bad, key.id);
      await expect(getApiKeyMetadata(key.key)).rejects.toThrow();
      await expect(getApiKeyById(key.id)).rejects.toThrow();
      await expect(getApiKeys()).rejects.toThrow();
      expect((await enforceApiKeyPolicy(request, "openai/gpt-4o")).rejection?.status).toBeGreaterThanOrEqual(400);
      const response = await catalog(key.key);
      expect(response.status).toBeGreaterThanOrEqual(400);
    }
  } finally { update.run("[]", key.id); }
  expect((await getApiKeyMetadata(key.key))?.allowedQuotas).toEqual([]);
  expect((await enforceApiKeyPolicy(request, "openai/gpt-4o")).rejection).toBeNull();
  const response = await catalog(key.key);
  expect(response.status).toBe(200);
  expect((await response.json() as {data: {id: string}[]}).data.some(model => model.id.startsWith("openai/"))).toBe(true);
});

test("invalid quota updates cannot silently become unrestricted", async () => {
  const key = await createApiKey("invalid update", "test");
  await updateApiKeyPermissions(key.id, { allowedQuotas: ["legacy-pool"] });
  for (const bad of [null, {}, "pool", [1], ["legacy-pool", null]]) {
    await expect(updateApiKeyPermissions(key.id, { allowedQuotas: bad } as any)).rejects.toThrow();
    expect((await getApiKeyById(key.id))?.allowedQuotas).toEqual(["legacy-pool"]);
  }
  await updateApiKeyPermissions(key.id, { allowedQuotas: [] });
  expect((await getApiKeyById(key.id))?.allowedQuotas).toEqual([]);
});

test("pool delete cannot launder a malformed mixed quota array into unrestricted access", async () => {
  const key = await createApiKey("delete malformed", "test");
  const conn = await createProviderConnection({ provider: "openai", authType: "apikey", apiKey: "fixture" } as any);
  const pool = createPool({ connectionId: conn.id, name: "malformed delete", exclusive: true,
    allocations: [{ apiKeyId: key.id, weight: 100, policy: "hard" }] });
  const db = getDbInstance();
  const value = JSON.stringify([pool.id, null]);
  db.prepare("UPDATE api_keys SET allowed_quotas = ? WHERE id = ?").run(value, key.id);
  await expect(deletePool(pool.id)).rejects.toThrow();
  expect(db.prepare("SELECT allowed_quotas FROM api_keys WHERE id = ?").get(key.id)).toEqual({ allowed_quotas: value });
  expect(db.prepare("SELECT id FROM quota_pools WHERE id = ?").get(pool.id)).toBeTruthy();
  expect(() => updatePool(pool.id, { allocations: [] })).toThrow();
  db.prepare("UPDATE api_keys SET allowed_quotas = '[]' WHERE id = ?").run(key.id);
});

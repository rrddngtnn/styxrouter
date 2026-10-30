import "./helpers/test-secrets";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createApiKey } from "../src/lib/db/apiKeys";
import { getDbInstance, SQLITE_FILE } from "../src/lib/db/core";
import { createProviderConnection } from "../src/lib/db/providers";
import { createPool } from "../src/lib/db/quotaPools";
import { createGroup } from "../src/lib/db/quotaGroups";
import { syncQuotaCombos } from "../src/lib/quota/quotaCombos";
import { getQuotaComboGeneration } from "../src/lib/db/quotaComboGeneration";
import { getCatalogPermissionRevision } from "../src/lib/db/catalogPermissionRevision";
import { createKeyGroup, addKeyToGroup, addGroupPermission } from "../src/lib/db/apiKeyGroups";
import { updateSettings } from "../src/lib/db/settings";
import {
  getUnifiedModelsResponse,
  __resetCatalogBuilderRunsForTest,
  __getCatalogBuilderRunsForTest,
  __expireCatalogCacheForTest,
} from "../src/app/api/v1/models/catalog";
import { resolveCachedCatalogResponse } from "../src/app/api/v1/models/catalogCache";

function writePolicy(sql: string, params: unknown[]) {
  // No ORM hooks, local invalidation, reconciliation worker, or TTL sleeps.
  const child = Bun.spawnSync([process.execPath, "-e", `
    const { Database } = require('bun:sqlite');
    const db = new Database(process.argv[1]);
    db.exec('PRAGMA busy_timeout = 5000');
    db.transaction(() => db.run(process.argv[2], JSON.parse(process.argv[3])))();
    db.close();
  `, SQLITE_FILE!, sql, JSON.stringify(params)], { env: process.env, stdout: "pipe", stderr: "pipe" });
  expect(new TextDecoder().decode(child.stderr)).toBe("");
  expect(child.exitCode).toBe(0);
}

async function catalog(key: string): Promise<string[]> {
  const response = await getUnifiedModelsResponse(new Request("http://localhost/v1/models", {
    headers: { authorization: `Bearer ${key}` },
  }));
  expect(response.status).toBe(200);
  const body = await response.json() as { data: { id: string }[] };
  return body.data.map(model => model.id);
}

async function fixture(name: string) {
  await updateSettings({ hideAutoCombos: true, hideNoThinkVariants: true });
  const key = await createApiKey(name, "test");
  const connection = await createProviderConnection({ provider: "openai", authType: "apikey", apiKey: "test-only", name });
  const group = createGroup(name);
  const pool = createPool({ connectionId: connection.id, groupId: group.id, name, exclusive: false,
    allocations: [{ apiKeyId: key.id, weight: 100, policy: "hard" }] });
  await syncQuotaCombos(pool.id);
  __resetCatalogBuilderRunsForTest();
  return { key, pool };
}

function comboRows() {
  return getDbInstance().prepare("SELECT id, name, data, updated_at FROM combos ORDER BY id").all();
}

test("real catalog drops an unrestricted cached body when another process grants exclusive quota access", async () => {
  const { key, pool } = await fixture("Catalog Exclusive");
  const before = await catalog(key.key);
  expect(before.some(id => id.startsWith("openai/"))).toBe(true);
  expect(await catalog(key.key)).toEqual(before);
  expect(__getCatalogBuilderRunsForTest()).toBe(1);
  const generation = getQuotaComboGeneration();
  const rows = comboRows();
  writePolicy("UPDATE api_keys SET allowed_quotas = ? WHERE id = ?", [JSON.stringify([pool.id]), key.id]);
  const restricted = await catalog(key.key);
  expect(restricted.length).toBeGreaterThan(0);
  expect(restricted.every(id => id.startsWith("qtSd/catalogexclusive/"))).toBe(true);
  expect(__getCatalogBuilderRunsForTest()).toBe(2);
  expect(await catalog(key.key)).toEqual(restricted);
  expect(__getCatalogBuilderRunsForTest()).toBe(2);
  expect(getQuotaComboGeneration()).toBe(generation);
  expect(comboRows()).toEqual(rows); // permission-only edits must not rebuild the projection
});

test("real catalog rejects stale-while-revalidate quota entries after cross-process revocation", async () => {
  const { key, pool } = await fixture("Catalog Revoked");
  writePolicy("UPDATE api_keys SET allowed_quotas = ? WHERE id = ?", [JSON.stringify([pool.id]), key.id]);
  const before = await catalog(key.key);
  expect(before.length).toBeGreaterThan(0);
  expect(before.every(id => id.startsWith("qtSd/catalogrevoked/"))).toBe(true);
  const generation = getQuotaComboGeneration();
  const rows = comboRows();
  __expireCatalogCacheForTest();
  writePolicy("UPDATE api_keys SET allowed_quotas = '[\"__quota_access_revoked__\"]' WHERE id = ?", [key.id]);
  expect(await catalog(key.key)).toEqual([]);
  expect(__getCatalogBuilderRunsForTest()).toBe(2);
  expect(getQuotaComboGeneration()).toBe(generation);
  expect(comboRows()).toEqual(rows);
});

test("real catalog refreshes cross-process model and group permission changes", async () => {
  const { key } = await fixture("Catalog Model Policy");
  expect((await catalog(key.key)).some(id => id.startsWith("openai/"))).toBe(true);
  const generation = getQuotaComboGeneration();
  const rows = comboRows();
  writePolicy("UPDATE api_keys SET model_access_mode = 'restricted', allowed_models = '[]' WHERE id = ?", [key.id]);
  expect(await catalog(key.key)).toEqual([]);
  writePolicy("UPDATE api_keys SET model_access_mode = 'all' WHERE id = ?", [key.id]);
  expect((await catalog(key.key)).length).toBeGreaterThan(0);
  const group = createKeyGroup("Catalog Policy Group");
  addGroupPermission(group.id, "*", "allow");
  addKeyToGroup(key.id, group.id);
  const before = await catalog(key.key);
  const rule = addGroupPermission(group.id, "*", "allow");
  await catalog(key.key); // prime after the local write; next write is child-only
  writePolicy("UPDATE group_model_permissions SET access_type = 'deny' WHERE id = ?", [rule.id]);
  expect(await catalog(key.key)).toEqual([]);
  writePolicy("UPDATE key_groups SET is_active = 0 WHERE id = ?", [group.id]);
  expect(await catalog(key.key)).toEqual(before);
  expect(getQuotaComboGeneration()).toBe(generation);
  expect(comboRows()).toEqual(rows);
});

test("permission revision commits and rolls back with policy, excluding usage writes", async () => {
  const { key } = await fixture("Catalog Revision");
  const db = getDbInstance();
  const revision = getCatalogPermissionRevision();
  db.prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?").run(key.id);
  expect(getCatalogPermissionRevision()).toBe(revision);
  expect(() => db.immediate(() => {
    db.prepare("UPDATE api_keys SET allowed_quotas = '[\"blocked\"]' WHERE id = ?").run(key.id);
    expect(getCatalogPermissionRevision()).toBeGreaterThan(revision);
    throw new Error("rollback policy");
  })).toThrow("rollback policy");
  expect(getCatalogPermissionRevision()).toBe(revision);
  writePolicy("UPDATE api_keys SET allowed_quotas = '[\"blocked\"]' WHERE id = ?", [key.id]);
  expect(getCatalogPermissionRevision()).toBeGreaterThan(revision);
  const committed = getCatalogPermissionRevision();
  // Reapplying additive DDL must preserve both permissions and the revision.
  db.exec(readFileSync(new URL("../src/lib/db/migrations/179_catalog_permission_revision.sql", import.meta.url), "utf8"));
  expect(getCatalogPermissionRevision()).toBe(committed);
  expect(db.prepare("SELECT allowed_quotas FROM api_keys WHERE id = ?").get(key.id)).toEqual({ allowed_quotas: '["blocked"]' });
});

test("old in-flight catalog work is not joined or stored after another process changes policy", async () => {
  const { key } = await fixture("Catalog Inflight");
  const request = new Request("http://localhost/v1/models?inflight-test", { headers: { authorization: `Bearer ${key.key}` } });
  const headers = { corsHeaders: {}, diagnosticHeaders: {} };
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { started = resolve; });
  const body = JSON.stringify(await catalog(key.key));
  __resetCatalogBuilderRunsForTest();
  const old = resolveCachedCatalogResponse(request, headers, async () => {
    // Hold a real catalog body across the cross-process policy write.
    started();
    await gate;
    return { body, headers: {}, status: 200, cacheTTL: 60000 };
  });
  await ready;
  writePolicy("UPDATE api_keys SET allowed_quotas = '[\"__quota_access_revoked__\"]' WHERE id = ?", [key.id]);
  const current = await catalog(key.key);
  expect(current).toEqual([]);
  release();
  expect((await (await old).json() as string[]).length).toBeGreaterThan(0);
  expect(await catalog(key.key)).toEqual([]);
});

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Database } from "bun:sqlite";

const { getDbInstance } = await import("../src/lib/db/core");
const {
  createProviderNode,
  deleteProviderNode,
  createProviderConnection,
  deleteProviderConnection,
  deleteProviderConnections,
  deleteProviderConnectionsByProvider,
} = await import("../src/lib/db/providers");
const {
  setProviderLimitsCache,
  getProviderLimitsCache,
} = await import("../src/lib/db/providerLimits");
const { getSanitizedCachedProviderLimitsMap } = await import("../src/lib/usage/providerLimits");
const {
  setQuotaCache,
  getQuotaCache,
} = await import("../src/domain/quotaCache");
const {
  setCredentialHealth,
  getCredentialHealth,
} = await import("../src/lib/credentialHealth/cache");
const { GET: getQuota } = await import("../src/app/api/usage/quota/route");
const { GET: getProviderLimits } = await import("../src/app/api/usage/provider-limits/route");

function seedSyncedModels(providerId: string, connectionId: string) {
  getDbInstance()
    .prepare("INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES ('syncedAvailableModels', ?, ?)")
    .run(`${providerId}:${connectionId}`, JSON.stringify([{ id: "model-a", name: "Model A" }]));
}

function hasSyncedModels(providerId: string, connectionId: string): boolean {
  return !!getDbInstance()
    .prepare("SELECT 1 FROM key_value WHERE namespace = 'syncedAvailableModels' AND key = ?")
    .get(`${providerId}:${connectionId}`);
}

test("deleteProviderConnection purges providerLimitsCache, syncedAvailableModels, quotaCache, and credentialHealth", async () => {
  const conn = await createProviderConnection({
    provider: "openai",
    name: "delete-single-cache-test",
    authType: "apikey",
    apiKey: "sk-test-single",
    isActive: true,
  });

  setProviderLimitsCache(conn.id, {
    quotas: { session: { used: 10, total: 100, remaining: 90 } },
    plan: "pro",
    message: null,
    fetchedAt: new Date().toISOString(),
  });
  seedSyncedModels("openai", conn.id);
  setQuotaCache(conn.id, "openai", { session: { remainingPercentage: 90, resetAt: null } });
  setCredentialHealth(conn.id, "openai", "active");

  expect(await deleteProviderConnection(conn.id)).toBe(true);

  expect(getProviderLimitsCache(conn.id)).toBeNull();
  expect(hasSyncedModels("openai", conn.id)).toBe(false);
  expect(getQuotaCache(conn.id)).toBeNull();
  expect(getCredentialHealth(conn.id)).toBeUndefined();

  const quotaJson = (await (await getQuota(new Request("http://localhost/api/usage/quota"))).json()) as any;
  expect(quotaJson.providers.some((p: any) => p.connectionId === conn.id)).toBe(false);

  const limitsJson = (await (await getProviderLimits()).json()) as any;
  expect(limitsJson.caches[conn.id]).toBeUndefined();
});

test("deleteProviderNode cascades to connections, quota_snapshots, providerLimitsCache, syncedAvailableModels, customModels, and quotaCache", async () => {
  const node = (await createProviderNode({
    type: "openai-compatible",
    name: "Custom-Cache-Test",
    prefix: "customcachetest",
    apiType: "chat",
    baseUrl: "https://custom-cache-test.example/v1",
  })) as { id: string };

  const conn = await createProviderConnection({
    provider: node.id,
    name: "Custom-Cache-Account",
    authType: "apikey",
    apiKey: "sk-custom-test",
    isActive: true,
  });

  const db = getDbInstance();
  db.prepare("INSERT INTO quota_snapshots (provider, connection_id, window_key) VALUES (?, ?, ?)")
    .run(node.id, conn.id, "daily");
  db.prepare("INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES ('customModels', ?, ?)")
    .run(node.id, JSON.stringify([{ id: "custom/model-1" }]));
  setProviderLimitsCache(conn.id, {
    quotas: { daily: { used: 5, total: 100, remaining: 95 } },
    plan: null,
    message: null,
    fetchedAt: new Date().toISOString(),
  });
  seedSyncedModels(node.id, conn.id);
  setQuotaCache(conn.id, node.id, { daily: { remainingPercentage: 95, resetAt: null } });
  setCredentialHealth(conn.id, node.id, "active");

  const deletedNode = await deleteProviderNode(node.id);
  expect(deletedNode).toBeTruthy();

  expect(db.prepare("SELECT id FROM provider_nodes WHERE id = ?").get(node.id)).toBeFalsy();
  expect(db.prepare("SELECT id FROM provider_connections WHERE provider = ?").all(node.id)).toEqual([]);
  expect(db.prepare("SELECT id FROM quota_snapshots WHERE connection_id = ?").all(conn.id)).toEqual([]);
  expect(db.prepare("SELECT value FROM key_value WHERE namespace = 'customModels' AND key = ?").get(node.id)).toBeFalsy();
  expect(getProviderLimitsCache(conn.id)).toBeNull();
  expect(hasSyncedModels(node.id, conn.id)).toBe(false);
  expect(getQuotaCache(conn.id)).toBeNull();
  expect(getCredentialHealth(conn.id)).toBeUndefined();

  const quotaJson = (await (await getQuota(new Request("http://localhost/api/usage/quota"))).json()) as any;
  expect(quotaJson.providers.some((p: any) => p.provider === node.id || p.connectionId === conn.id)).toBe(false);

  const limitsJson = (await (await getProviderLimits()).json()) as any;
  expect(limitsJson.caches[conn.id]).toBeUndefined();
});

test("deleteProviderConnections and deleteProviderConnectionsByProvider clear connection caches", async () => {
  const c1 = await createProviderConnection({
    provider: "openai",
    name: "bulk-cache-1",
    authType: "apikey",
    apiKey: "sk-1",
    isActive: true,
  });
  const c2 = await createProviderConnection({
    provider: "claude",
    name: "bulk-cache-2",
    authType: "apikey",
    apiKey: "sk-2",
    isActive: true,
  });

  for (const [id, prov] of [
    [c1.id, "openai"],
    [c2.id, "claude"],
  ] as const) {
    setProviderLimitsCache(id, {
      quotas: { session: { remaining: 50 } },
      plan: null,
      message: null,
      fetchedAt: new Date().toISOString(),
    });
    seedSyncedModels(prov, id);
    setQuotaCache(id, prov, { session: { remainingPercentage: 50, resetAt: null } });
    setCredentialHealth(id, prov, "active");
  }

  expect(await deleteProviderConnections([c1.id])).toBe(1);
  expect(getProviderLimitsCache(c1.id)).toBeNull();
  expect(hasSyncedModels("openai", c1.id)).toBe(false);
  expect(getQuotaCache(c1.id)).toBeNull();
  expect(getCredentialHealth(c1.id)).toBeUndefined();

  expect(await deleteProviderConnectionsByProvider("claude")).toBeGreaterThanOrEqual(1);
  expect(getProviderLimitsCache(c2.id)).toBeNull();
  expect(hasSyncedModels("claude", c2.id)).toBe(false);
  expect(getQuotaCache(c2.id)).toBeNull();
  expect(getCredentialHealth(c2.id)).toBeUndefined();
});

test("getSanitizedCachedProviderLimitsMap excludes orphaned providerLimitsCache rows", async () => {
  setProviderLimitsCache("orphan-conn-id", {
    quotas: { session: { remaining: 10 } },
    plan: null,
    message: null,
    fetchedAt: new Date().toISOString(),
  });

  const sanitized = await getSanitizedCachedProviderLimitsMap();
  expect(sanitized["orphan-conn-id"]).toBeUndefined();
});

test("migration 186 removes orphaned custom-node connections and orphaned key_value caches", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE provider_nodes (id TEXT PRIMARY KEY);
    CREATE TABLE provider_connections (id TEXT PRIMARY KEY, provider TEXT NOT NULL);
    CREATE TABLE quota_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT, connection_id TEXT);
    CREATE TABLE proxy_assignments (scope TEXT, scope_id TEXT);
    CREATE TABLE key_value (namespace TEXT, key TEXT, value TEXT, PRIMARY KEY (namespace, key));
  `);

  const deletedUuidNode = "11111111-1111-1111-1111-111111111111";
  const deletedCompatNode = "openai-compatible-chat-22222222-2222-2222-2222-222222222222";
  const liveNode = "33333333-3333-3333-3333-333333333333";

  db.prepare("INSERT INTO provider_nodes (id) VALUES (?)").run(liveNode);
  db.prepare("INSERT INTO provider_connections (id, provider) VALUES (?, ?)").run("conn-orphan-uuid", deletedUuidNode);
  db.prepare("INSERT INTO provider_connections (id, provider) VALUES (?, ?)").run("conn-orphan-compat", deletedCompatNode);
  db.prepare("INSERT INTO provider_connections (id, provider) VALUES (?, ?)").run("conn-live-node", liveNode);
  db.prepare("INSERT INTO provider_connections (id, provider) VALUES (?, ?)").run("conn-builtin", "openai");

  db.prepare("INSERT INTO quota_snapshots (provider, connection_id) VALUES (?, ?)").run(deletedUuidNode, "conn-orphan-uuid");
  db.prepare("INSERT INTO proxy_assignments (scope, scope_id) VALUES ('account', ?)").run("conn-orphan-compat");
  db.prepare("INSERT INTO key_value (namespace, key, value) VALUES ('providerLimitsCache', ?, '{}')").run("conn-orphan-uuid");
  db.prepare("INSERT INTO key_value (namespace, key, value) VALUES ('providerLimitsCache', ?, '{}')").run("conn-deleted");
  db.prepare("INSERT INTO key_value (namespace, key, value) VALUES ('providerLimitsCache', ?, '{}')").run("conn-live-node");
  db.prepare("INSERT INTO key_value (namespace, key, value) VALUES ('syncedAvailableModels', ?, '[]')").run(`${deletedUuidNode}:conn-orphan-uuid`);
  db.prepare("INSERT INTO key_value (namespace, key, value) VALUES ('syncedAvailableModels', ?, '[]')").run(`openai:conn-deleted`);
  db.prepare("INSERT INTO key_value (namespace, key, value) VALUES ('syncedAvailableModels', ?, '[]')").run(`${liveNode}:conn-live-node`);
  db.prepare("INSERT INTO key_value (namespace, key, value) VALUES ('customModels', ?, '[]')").run(deletedUuidNode);
  db.prepare("INSERT INTO key_value (namespace, key, value) VALUES ('customModels', ?, '[]')").run(liveNode);
  db.prepare("INSERT INTO key_value (namespace, key, value) VALUES ('proxyConfig', 'global', '{}')").run();

  const sql = readFileSync(new URL("../src/lib/db/migrations/186_cleanup_orphan_provider_caches.sql", import.meta.url), "utf8");
  db.exec(sql);

  expect(db.query("SELECT id FROM provider_connections ORDER BY id").all()).toEqual([
    { id: "conn-builtin" },
    { id: "conn-live-node" },
  ]);
  expect(db.query("SELECT connection_id FROM quota_snapshots").all()).toEqual([]);
  expect(db.query("SELECT scope_id FROM proxy_assignments").all()).toEqual([]);
  expect(db.query("SELECT key FROM key_value WHERE namespace = 'providerLimitsCache'").all()).toEqual([
    { key: "conn-live-node" },
  ]);
  expect(db.query("SELECT key FROM key_value WHERE namespace = 'syncedAvailableModels'").all()).toEqual([
    { key: `${liveNode}:conn-live-node` },
  ]);
  expect(db.query("SELECT key FROM key_value WHERE namespace = 'customModels'").all()).toEqual([
    { key: liveNode },
  ]);
  expect(db.query("SELECT key FROM key_value WHERE namespace = 'proxyConfig'").all()).toEqual([
    { key: "global" },
  ]);
  db.close();
});

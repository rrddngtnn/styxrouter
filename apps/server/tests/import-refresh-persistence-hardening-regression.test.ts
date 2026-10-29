import { expect, test } from "bun:test";
process.env.STORAGE_ENCRYPTION_KEY = "synthetic-persistence-key";

test("imported refresh writes reject missing encryption even with a cached key and leave the entire row unchanged", async () => {
  const { createProviderConnection, updateProviderConnection } = await import("../src/lib/db/providers.ts");
  const { getDbInstance } = await import("../src/lib/db/core.ts");
  const conn: any = await createProviderConnection({ provider: "codebuddy-cn", authType: "oauth", name: "synthetic", accessToken: "synthetic-access-before", refreshToken: "synthetic-refresh-before", expiresAt: new Date(0).toISOString(), providerSpecificData: { importedToken: true } });
  const db = getDbInstance();
  const raw = () => db.prepare("SELECT access_token, refresh_token, expires_at FROM provider_connections WHERE id = ?").get(conn.id);
  const before = raw();
  const key = process.env.STORAGE_ENCRYPTION_KEY;
  process.env.STORAGE_ENCRYPTION_KEY = "";
  try {
    await expect(updateProviderConnection(conn.id, { accessToken: "synthetic-access-after", refreshToken: "synthetic-refresh-after", expiresAt: new Date().toISOString() })).rejects.toThrow();
    expect(raw()).toEqual(before);
  } finally { process.env.STORAGE_ENCRYPTION_KEY = key; }
}, 30000);

test("imported refresh rejects a changed key instead of writing under the cached old key", async () => {
  const { createProviderConnection, updateProviderConnection } = await import("../src/lib/db/providers.ts");
  const { getDbInstance } = await import("../src/lib/db/core.ts");
  const conn: any = await createProviderConnection({ provider: "codebuddy-cn", authType: "oauth", name: "synthetic-key-change", accessToken: "synthetic-key-access", refreshToken: "synthetic-key-refresh", providerSpecificData: { importedToken: true } });
  const db = getDbInstance();
  const raw = () => db.prepare("SELECT access_token, refresh_token FROM provider_connections WHERE id = ?").get(conn.id);
  const before = raw();
  const key = process.env.STORAGE_ENCRYPTION_KEY;
  process.env.STORAGE_ENCRYPTION_KEY = "synthetic-different-key";
  try {
    await expect(updateProviderConnection(conn.id, { accessToken: "synthetic-new-key-access", refreshToken: "synthetic-new-key-refresh" })).rejects.toThrow();
    expect(raw()).toEqual(before);
  } finally { process.env.STORAGE_ENCRYPTION_KEY = key; }
}, 30000);

test("crypto failure during the second field rolls back the entire imported pair", async () => {
  const crypto = await import("node:crypto");
  const { spyOn } = await import("bun:test");
  const { createProviderConnection, updateProviderConnection } = await import("../src/lib/db/providers.ts");
  const { getDbInstance } = await import("../src/lib/db/core.ts");
  const conn: any = await createProviderConnection({ provider: "codebuddy-cn", authType: "oauth", name: "synthetic-crypto-failure", accessToken: "synthetic-crypto-old-access", refreshToken: "synthetic-crypto-old-refresh", providerSpecificData: { importedToken: true } });
  const db = getDbInstance();
  const raw = () => db.prepare("SELECT access_token, refresh_token FROM provider_connections WHERE id = ?").get(conn.id);
  const before = raw();
  const original = crypto.randomBytes;
  const originalError = console.error;
  const logs: unknown[] = [];
  console.error = (...args) => { logs.push(args); };
  let calls = 0;
  const spy = spyOn(crypto, "randomBytes").mockImplementation(((...args: any[]) => { if (++calls === 2) throw new Error("synthetic-crypto-secret"); return (original as any)(...args); }) as any);
  try {
    await expect(updateProviderConnection(conn.id, { accessToken: "synthetic-crypto-new-access", refreshToken: "synthetic-crypto-new-refresh" })).rejects.toThrow();
    expect(calls).toBe(2);
    expect(raw()).toEqual(before);
    expect(JSON.stringify(logs)).not.toContain("synthetic-crypto-secret");
  } finally { spy.mockRestore(); console.error = originalError; }
}, 30000);

test("a rejected SQLite write rolls back both encrypted credentials and expiry", async () => {
  const { createProviderConnection, updateProviderConnection } = await import("../src/lib/db/providers.ts");
  const { getDbInstance } = await import("../src/lib/db/core.ts");
  const conn: any = await createProviderConnection({ provider: "codebuddy-cn", authType: "oauth", name: "synthetic-sqlite", accessToken: "synthetic-sqlite-access", refreshToken: "synthetic-sqlite-refresh", expiresAt: new Date(0).toISOString(), providerSpecificData: { importedToken: true } });
  const db = getDbInstance();
  const raw = () => db.prepare("SELECT access_token, refresh_token, expires_at FROM provider_connections WHERE id = ?").get(conn.id);
  const before = raw();
  db.exec("CREATE TRIGGER synthetic_reject_refresh BEFORE UPDATE ON provider_connections BEGIN SELECT RAISE(ABORT, 'synthetic rejected write'); END");
  try {
    await expect(updateProviderConnection(conn.id, { accessToken: "synthetic-sqlite-new-access", refreshToken: "synthetic-sqlite-new-refresh", expiresAt: new Date().toISOString() })).rejects.toThrow();
    expect(raw()).toEqual(before);
  } finally { db.exec("DROP TRIGGER synthetic_reject_refresh"); }
}, 30000);

test("imported refresh without a persistence callback is rejected before contacting upstream", async () => {
  const { getAccessToken } = await import("../open-sse/services/tokenRefresh.ts");
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls++; throw new Error("unexpected fetch"); }) as typeof fetch;
  try {
    await expect(getAccessToken("codebuddy-cn", { refreshToken: "synthetic-without-persist", providerSpecificData: { importedToken: true } }, {}, null)).rejects.toThrow();
    expect(calls).toBe(0);
  } finally { globalThis.fetch = original; }
});

test("imported refresh is blocked even inside a CAS guard", async () => {
  const { createProviderConnection, getProviderConnectionById } = await import("../src/lib/db/providers.ts");
  const { getAccessToken, runWithCasGuard } = await import("../open-sse/services/tokenRefresh.ts");
  const conn: any = await createProviderConnection({ provider: "codebuddy-cn", authType: "oauth", name: "synthetic-cas", accessToken: "synthetic-cas-old-access", refreshToken: "synthetic-cas-old-refresh", providerSpecificData: { importedToken: true } });
  const credentials: any = { ...await getProviderConnectionById(conn.id), connectionId: conn.id };
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return Response.json({ code: 0, data: { accessToken: "synthetic-cas-new-access", refreshToken: "synthetic-cas-new-refresh", expiresIn: 3600 } }); }) as typeof fetch;
  const { getDbInstance } = await import("../src/lib/db/core.ts");
  const raw = () => getDbInstance().prepare("SELECT access_token, refresh_token FROM provider_connections WHERE id = ?").get(conn.id);
  const before: any = raw();
  expect(before.refresh_token).toStartWith("enc:v1:");
  let persisted = false;
  try {
    await expect(runWithCasGuard({ expectedRefreshToken: credentials.refreshToken, reread: async () => "synthetic-other-refresh" }, () => getAccessToken("codebuddy-cn", credentials, {}, null, async () => { persisted = true; }))).rejects.toThrow();
    expect(persisted).toBe(false);
    expect(calls).toBe(0);
    expect(raw()).toEqual(before);
  } finally { globalThis.fetch = original; }
}, 30000);

test("imported refresh never invokes the persistence callback or upstream", async () => {
  const { createProviderConnection, getProviderConnectionById } = await import("../src/lib/db/providers.ts");
  const { getAccessToken } = await import("../open-sse/services/tokenRefresh.ts");
  const conn: any = await createProviderConnection({ provider: "codebuddy-cn", authType: "oauth", name: "synthetic-callback", accessToken: "synthetic-callback-old-access", refreshToken: "synthetic-callback-old-refresh", providerSpecificData: { importedToken: true } });
  const credentials: any = { ...await getProviderConnectionById(conn.id), connectionId: conn.id };
  const original = globalThis.fetch;
  const logs: unknown[] = [];
  const { getDbInstance } = await import("../src/lib/db/core.ts");
  const raw = () => getDbInstance().prepare("SELECT access_token, refresh_token FROM provider_connections WHERE id = ?").get(conn.id);
  const before: any = raw();
  expect(before.refresh_token).toStartWith("enc:v1:");
  let calls = 0, callbacks = 0;
  globalThis.fetch = (async () => { calls++; return Response.json({ code: 0, data: { accessToken: "synthetic-callback-new-access", refreshToken: "synthetic-callback-new-refresh", expiresIn: 3600 } }); }) as typeof fetch;
  try {
    await expect(getAccessToken("codebuddy-cn", credentials, { error: (...args: unknown[]) => logs.push(args) }, null, async () => { callbacks++; throw new Error("synthetic-callback-secret"); })).rejects.toThrow("Imported credential refresh is disabled; re-authenticate the connection");
    expect(calls).toBe(0);
    expect(callbacks).toBe(0);
    expect(raw()).toEqual(before);
    expect(JSON.stringify(logs)).not.toContain("synthetic-callback-secret");
  } finally { globalThis.fetch = original; }
}, 30000);

test("ordinary CBCN encryption failure after exchange leaves credentials unchanged and retains the fence", async () => {
  const { createProviderConnection, getProviderConnectionById } = await import("../src/lib/db/providers.ts");
  const { getDbInstance } = await import("../src/lib/db/core.ts");
  const { getAccessToken } = await import("../open-sse/services/tokenRefresh.ts");
  const crypto = await import("node:crypto");
  const { spyOn } = await import("bun:test");
  const conn: any = await createProviderConnection({ provider: "codebuddy-cn", authType: "oauth", name: "synthetic-cas-regular", accessToken: "synthetic-cas-regular-old", refreshToken: "synthetic-cas-regular-refresh", expiresAt: new Date(0).toISOString() });
  const credentials: any = { ...await getProviderConnectionById(conn.id), connectionId: conn.id };
  const db = getDbInstance();
  const raw = () => db.prepare("SELECT access_token, refresh_token, expires_at, token_expires_at FROM provider_connections WHERE id = ?").get(conn.id);
  const before = raw();
  const original = globalThis.fetch;
  const originalError = console.error;
  const logs: unknown[] = [];
  console.error = (...args) => { logs.push(args); };
  let calls = 0, encryptCalls = 0, callbacks = 0;
  const originalRandom = crypto.randomBytes;
  const spy = spyOn(crypto, "randomBytes").mockImplementation(((...args: any[]) => { if (++encryptCalls === 2) throw new Error("synthetic-encryption-secret"); return (originalRandom as any)(...args); }) as any);
  globalThis.fetch = (async () => { calls++; return Response.json({ code: 0, data: { accessToken: "synthetic-cas-new", refreshToken: "synthetic-cas-rotated", expiresIn: 3600 } }); }) as typeof fetch;
  try {
    const refresh = () => getAccessToken("codebuddy-cn", credentials, {}, null, async () => { callbacks++; });
    await expect(refresh()).rejects.toThrow("Refresh unavailable; re-authenticate the connection");
    expect(calls).toBe(1);
    expect(encryptCalls).toBe(2);
    expect(callbacks).toBe(0);
    expect(raw()).toEqual(before);
    await expect(refresh()).rejects.toThrow("Refresh unavailable; re-authenticate the connection");
    expect(calls).toBe(1);
    expect(raw()).toEqual(before);
    expect(JSON.stringify(logs)).not.toContain("synthetic-encryption-secret");
  } finally { spy.mockRestore(); globalThis.fetch = original; console.error = originalError; }
}, 30000);

test("strict persistence wrapper rejects failed imported writes without logging database secrets", async () => {
  const { createProviderConnection } = await import("../src/lib/db/providers.ts");
  const { updateProviderCredentials } = await import("../src/sse/services/tokenRefresh.ts");
  const { getDbInstance } = await import("../src/lib/db/core.ts");
  const conn: any = await createProviderConnection({ provider: "codebuddy-cn", authType: "oauth", name: "synthetic-wrapper", accessToken: "synthetic-wrapper-old", refreshToken: "synthetic-wrapper-refresh", providerSpecificData: { importedToken: true } });
  const db = getDbInstance();
  const raw = () => db.prepare("SELECT access_token, refresh_token, expires_at FROM provider_connections WHERE id = ?").get(conn.id);
  const before: any = raw();
  expect(before.refresh_token).toStartWith("enc:v1:");
  const logs: unknown[] = [];
  const oldError = console.error;
  console.error = (...args) => { logs.push(args); };
  db.exec("CREATE TRIGGER synthetic_wrapper_reject BEFORE UPDATE ON provider_connections BEGIN SELECT RAISE(ABORT, 'synthetic-database-secret'); END");
  try {
    expect(await updateProviderCredentials(conn.id, { accessToken: "synthetic-new", refreshToken: "synthetic-rotated", expiresIn: 3600 })).toBe(false);
    expect(raw()).toEqual(before);
    expect(JSON.stringify(logs)).not.toContain("synthetic-database-secret");
  } finally { db.exec("DROP TRIGGER synthetic_wrapper_reject"); console.error = oldError; }
}, 30000);

test("expired imported proactive refresh is blocked even when encryption is unavailable", async () => {
  const { createProviderConnection, getProviderConnectionById } = await import("../src/lib/db/providers.ts");
  const { checkAndRefreshToken } = await import("../src/sse/services/tokenRefresh.ts");
  const conn: any = await createProviderConnection({ provider: "codebuddy-cn", authType: "oauth", name: "synthetic-rejection", accessToken: "synthetic-reject-old-access", refreshToken: "synthetic-reject-old-refresh", expiresAt: new Date(0).toISOString(), providerSpecificData: { importedToken: true } });
  const credentials: any = { ...await getProviderConnectionById(conn.id), connectionId: conn.id };
  const fetchBefore = globalThis.fetch;
  const key = process.env.STORAGE_ENCRYPTION_KEY;
  const { getDbInstance } = await import("../src/lib/db/core.ts");
  const raw = () => getDbInstance().prepare("SELECT access_token, refresh_token, expires_at FROM provider_connections WHERE id = ?").get(conn.id);
  const before: any = raw();
  expect(before.refresh_token).toStartWith("enc:v1:");
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return Response.json({ code: 0, data: { accessToken: "synthetic-reject-new-access", refreshToken: "synthetic-reject-new-refresh", expiresIn: 3600 } }); }) as typeof fetch;
  process.env.STORAGE_ENCRYPTION_KEY = "";
  try {
    const result = await checkAndRefreshToken("codebuddy-cn", credentials);
    expect(result.accessToken).toBe(credentials.accessToken);
    expect(calls).toBe(0);
    expect(raw()).toEqual(before);
  } finally { process.env.STORAGE_ENCRYPTION_KEY = key; globalThis.fetch = fetchBefore; }
  const row: any = await getProviderConnectionById(conn.id);
  expect(row.accessToken).toBe("synthetic-reject-old-access");
  expect(row.refreshToken).toBe("synthetic-reject-old-refresh");
}, 30000);

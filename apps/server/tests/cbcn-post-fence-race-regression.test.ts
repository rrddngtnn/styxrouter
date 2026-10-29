import { expect, test } from "bun:test";
process.env.STORAGE_ENCRYPTION_KEY = "synthetic-cbcn-post-fence-key";
process.env.STYX_TEST_MODE = "1";

test("quota refresh never overwrites a later rotation after the fence commits", async () => {
  const { createProviderConnection, getProviderConnectionById } = await import("../src/lib/db/providers.ts");
  const { getDbInstance } = await import("../src/lib/db/core.ts");
  const { encrypt } = await import("../src/lib/db/encryption.ts");
  const { refreshAndUpdateCredentials } = await import("../src/lib/usage/providerLimits.ts");
  const connection: any = await createProviderConnection({ provider: "codebuddy-cn", authType: "oauth", name: "synthetic quota", accessToken: "old-access", refreshToken: "old-refresh" });
  const db = getDbInstance();
  const laterAccess = encrypt("later-access");
  const laterRefresh = encrypt("later-refresh");
  db.exec(`CREATE TRIGGER cbcn_later_rotation AFTER INSERT ON config_audit_log WHEN NEW.action = 'cbcn_refresh' BEGIN UPDATE provider_connections SET access_token = '${laterAccess}', refresh_token = '${laterRefresh}' WHERE id = NEW.target_id; END`);
  const original = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({ code: 0, data: { accessToken: "middle-access", refreshToken: "middle-refresh", expiresIn: 3600 } })) as typeof fetch;
  try {
    await refreshAndUpdateCredentials(connection, { force: true, allowRotatingRefresh: true });
    const latest: any = await getProviderConnectionById(connection.id);
    expect(latest.accessToken).toBe("later-access");
    expect(latest.refreshToken).toBe("later-refresh");
  } finally {
    globalThis.fetch = original;
    db.exec("DROP TRIGGER cbcn_later_rotation");
  }
}, 30000);

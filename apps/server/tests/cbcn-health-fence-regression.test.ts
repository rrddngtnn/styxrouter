import { expect, spyOn, test } from "bun:test";
process.env.STORAGE_ENCRYPTION_KEY = "synthetic-cbcn-health-fence";
process.env.STYX_TEST_MODE = "1";

for (const concurrent of [false, true]) test(`health refresh ${concurrent ? "does not update a newer rotation" : "clears health state for its own rotation"}`, async () => {
  const p = await import("../src/lib/db/providers.ts");
  const core = await import("../src/lib/db/core.ts");
  const crypt = await import("../src/lib/db/encryption.ts");
  const refresh = await import("../open-sse/services/tokenRefresh.ts");
  const c: any = await p.createProviderConnection({ provider: "codebuddy-cn", authType: "oauth", name: `health-${concurrent}`, accessToken: "old-access", refreshToken: `old-refresh-${concurrent}`, isActive: true, testStatus: "error", lastError: "old error", lastErrorType: "token_refresh_failed", errorCode: "old-code", expiresAt: "2000-01-01T00:00:00.000Z", providerSpecificData: { refreshCircuit: { failureCount: 2 }, retained: "yes" } });
  const oldFetch = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({ code: 0, data: { accessToken: "middle-access", refreshToken: `middle-refresh-${concurrent}`, expiresIn: 3600 } })) as typeof fetch;
  const original = refresh.getAccessToken;
  const spy = spyOn(refresh, "getAccessToken").mockImplementation(async (...args: any[]) => {
    const result = await (original as any)(...args);
    if (concurrent) {
      const code = `import { Database } from 'bun:sqlite'; import { encrypt } from ${JSON.stringify(import.meta.dir + "/../src/lib/db/encryption.ts")}; const db = new Database(process.env.DATA_DIR + '/storage.sqlite'); db.query('UPDATE provider_connections SET access_token=?,refresh_token=?,test_status=?,last_error=?,provider_specific_data=? WHERE id=?').run(encrypt('later-access'),encrypt('later-refresh'),'error','new error',JSON.stringify({refreshCircuit:{failureCount:9},retained:'new'}),${JSON.stringify(c.id)}); db.close();`;
      const child = Bun.spawn([process.execPath, "-e", code], { env: process.env, stderr: "pipe" });
      const error = await new Response(child.stderr).text();
      expect(await child.exited).toBe(0); expect(error).toBe("");
    }
    return result;
  });
  try {
    const health = await import("../src/lib/tokenHealthCheck.ts");
    await health.checkConnection(c);
    const row: any = core.getDbInstance().prepare("SELECT * FROM provider_connections WHERE id = ?").get(c.id);
    const metadata = JSON.parse(row.provider_specific_data);
    if (concurrent) {
      expect(crypt.decrypt(row.access_token)).toBe("later-access");
      expect(crypt.decrypt(row.refresh_token)).toBe("later-refresh");
      expect(row.test_status).toBe("error"); expect(row.last_error).toBe("new error");
      expect(metadata).toEqual({ refreshCircuit: { failureCount: 9 }, retained: "new" });
      expect(row.last_health_check_at).toBeNull();
    } else {
      expect(crypt.decrypt(row.refresh_token)).toBe("middle-refresh-false");
      expect(row.test_status).toBe("active"); expect(row.last_error).toBeNull();
      expect(row.last_error_type).toBeNull(); expect(row.error_code).toBeNull();
      expect(metadata).toEqual({ retained: "yes" });
      expect(row.last_health_check_at).toBeTruthy();
      const { recordRefreshHealth } = await import("../src/lib/db/codebuddyRefreshFence.ts");
      expect(recordRefreshHealth({ db: core.getDbInstance(), connectionId: c.id }, { accessToken: "middle-access", refreshToken: "middle-refresh-false" }, new Date().toISOString())).toBe(true);
    }
  } finally { spy.mockRestore(); globalThis.fetch = oldFetch; }
}, 30000);

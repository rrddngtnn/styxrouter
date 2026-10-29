import { expect, test } from "bun:test";
process.env.STORAGE_ENCRYPTION_KEY = "synthetic-cbcn-fenced-route";
process.env.STYX_TEST_MODE = "1";

test("CBCN real refresh persists via fence and blocks marked imports", async () => {
  const { createProviderConnection, getProviderConnectionById } = await import("../src/lib/db/providers.ts");
  const { updateProviderCredentials } = await import("../src/sse/services/tokenRefresh.ts");
  const { getAccessToken } = await import("../open-sse/services/tokenRefresh.ts");
  const ordinary: any = await createProviderConnection({ provider: "codebuddy-cn", authType: "oauth", name: "synthetic ordinary", accessToken: "synthetic-access", refreshToken: "synthetic-refresh" });
  const imported: any = await createProviderConnection({ provider: "codebuddy-cn", authType: "oauth", name: "synthetic dormant", accessToken: "synthetic-import-access", refreshToken: "synthetic-import-refresh", providerSpecificData: { importedToken: true } });
  const original = globalThis.fetch;
  let calls = 0;
  let callbacks = 0;
  globalThis.fetch = (async () => { calls++; return Response.json({ code: 0, data: { accessToken: "synthetic-new-access", refreshToken: "synthetic-new-refresh", expiresIn: 3600 } }); }) as typeof fetch;
  try {
    const result = await getAccessToken("codebuddy-cn", { connectionId: ordinary.id, refreshToken: ordinary.refreshToken }, null, null, async (value: any) => {
      callbacks++;
      expect(value.refreshToken).toBe("synthetic-new-refresh");
      expect(await updateProviderCredentials(ordinary.id, value)).toBe(true);
    });
    expect(result.accessToken).toBe("synthetic-new-access");
    expect(callbacks).toBe(0);
    expect((await getProviderConnectionById(ordinary.id) as any).refreshToken).toBe("synthetic-new-refresh");
    const savedImport: any = await getProviderConnectionById(imported.id);
    expect(savedImport.providerSpecificData.importedToken).toBe(true);
    await expect(getAccessToken("codebuddy-cn", { ...savedImport, connectionId: imported.id }, null, null, async () => { callbacks++; })).rejects.toThrow(/imported credential refresh.*disabled/i);
    expect(callbacks).toBe(0);
    expect(calls).toBe(1);
    expect((await getProviderConnectionById(imported.id) as any).refreshToken).toBe("synthetic-import-refresh");
  } finally { globalThis.fetch = original; }
}, 30000);

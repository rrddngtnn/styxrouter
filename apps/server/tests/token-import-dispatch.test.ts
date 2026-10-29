import { expect, test } from "bun:test";
process.env.STORAGE_ENCRYPTION_KEY = "isolated-dispatch-encryption-key";
process.env.STYX_TEST_MODE = "1";

test("imports fail closed without an encryption key", async () => {
  const { prepareTokenImport, saveTokenImport } = await import("../server/tokenImport.ts");
  const saved = process.env.STORAGE_ENCRYPTION_KEY;
  process.env.STORAGE_ENCRYPTION_KEY = " ";
  try {
    const items = prepareTokenImport({ provider: "codebuddy-cn", accounts: { accessToken: "synthetic-unencrypted" } })!;
    const result: any = (await saveTokenImport(items, () => {}))[0];
    expect(result.valid).toBe(false);
    expect(result.error).toContain("encryption");
  } finally { process.env.STORAGE_ENCRYPTION_KEY = saved; }
});

test("CBCN refresh errors do not log upstream response text", async () => {
  const { refreshCodebuddyCnToken } = await import("../open-sse/services/tokenRefresh/providers/codebuddyCn.ts");
  const { createProviderConnection } = await import("../src/lib/db/providers.ts");
  const { getDbInstance } = await import("../src/lib/db/core.ts");
  const saved: any = await createProviderConnection({ provider: "codebuddy-cn", authType: "oauth", name: "synthetic-error", accessToken: "synthetic-error-access", refreshToken: "synthetic-refresh" });
  const context = { db: getDbInstance(), connectionId: saved.id };
  const original = globalThis.fetch;
  const messages: unknown[] = [];
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return new Response("synthetic-secret-in-upstream-error", { status: 401 }); }) as typeof fetch;
  try {
    await expect(refreshCodebuddyCnToken("synthetic-refresh", { error: (...args: unknown[]) => messages.push(args) } as any, null, context)).rejects.toThrow(/re-authenticate/i);
    await expect(refreshCodebuddyCnToken("synthetic-refresh", null, null, context)).rejects.toThrow(/re-authenticate/i);
    expect(calls).toBe(1);
    expect(JSON.stringify(messages)).not.toContain("synthetic-secret-in-upstream-error");
  } finally { globalThis.fetch = original; }
});

test("CBCN non-imported refresh persists rotated credentials", async () => {
  const { createProviderConnection, getProviderConnectionById } = await import("../src/lib/db/providers.ts");
  const { getAccessToken } = await import("../open-sse/services/tokenRefresh.ts");
  const { updateProviderCredentials, checkAndRefreshToken } = await import("../src/sse/services/tokenRefresh.ts");
  const saved: any = await createProviderConnection({ provider: "codebuddy-cn", authType: "oauth", name: "synthetic-refresh", accessToken: "synthetic-old-access", refreshToken: "synthetic-old-refresh", expiresAt: new Date(0).toISOString() });
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (_url: any, options: any) => {
    calls++;
    expect(new Headers(options.headers).get("X-Refresh-Token")).toBe("synthetic-old-refresh");
    return Response.json({ code: 0, data: { accessToken: "synthetic-new-access", refreshToken: "synthetic-new-refresh", expiresIn: 3600 } });
  }) as typeof fetch;
  try {
    const old: any = await getProviderConnectionById(saved.id);
    const result = await getAccessToken("codebuddy-cn", { ...old, connectionId: saved.id }, {}, null, async (value: any) => { expect(await updateProviderCredentials(saved.id, value)).toBe(true); });
    expect(result.accessToken).toBe("synthetic-new-access");
    const row: any = await getProviderConnectionById(saved.id);
    expect(row.accessToken).toBe("synthetic-new-access");
    expect(row.refreshToken).toBe("synthetic-new-refresh");
    await checkAndRefreshToken("codebuddy-cn", { accessToken: "synthetic-no-refresh", expiresAt: new Date(0).toISOString(), providerSpecificData: { importedToken: true, nonRefreshable: true } });
    expect(calls).toBe(1);
  } finally { globalThis.fetch = original; }
}, 30000);

test("imported CBCN OAuth and existing API-key connections produce bearer headers", async () => {
  const { prepareTokenImport, saveTokenImport } = await import("../server/tokenImport.ts");
  const { createProviderConnection } = await import("../src/lib/db/providers.ts");
  const { getProviderCredentials } = await import("../src/sse/services/auth.ts");
  const { CodeBuddyCnExecutor } = await import("../open-sse/executors/codebuddy-cn.ts");
  const { REGISTRY } = await import("../open-sse/config/providers/index.ts");
  expect(REGISTRY["codebuddy-cn"].authModes).toContain("apikey");
  const entries = prepareTokenImport({ provider: "codebuddy-cn", accounts: { access_token: "synthetic-dispatch-token" } })!;
  const imported: any = (await saveTokenImport(entries, () => {}))[0];
  expect(imported.valid).toBe(true);
  const credentials: any = await getProviderCredentials("codebuddy-cn", null, [imported.id]);
  expect(credentials.connectionId).toBe(imported.id);
  const executor = new CodeBuddyCnExecutor();
  expect(executor.buildHeaders(credentials).Authorization).toBe("Bearer synthetic-dispatch-token");
  const key: any = await createProviderConnection({ provider: "codebuddy-cn", authType: "apikey", name: "synthetic key", apiKey: "synthetic-api-key" });
  const keyCreds: any = await getProviderCredentials("codebuddy-cn", null, [key.id]);
  expect(executor.buildHeaders(keyCreds).Authorization).toBe("Bearer synthetic-api-key");
}, 30000);

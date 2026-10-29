import { expect, test } from "bun:test";

test("imported rotating refresh is disabled before any upstream call", async () => {
  const { getAccessToken, refreshAccessToken } = await import("../open-sse/services/tokenRefresh.ts");
  const { XaiExecutor } = await import("../open-sse/executors/xai.ts");
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls++; throw new Error("synthetic-secret"); }) as typeof fetch;
  const credentials: any = { connectionId: "synthetic-id", refreshToken: "synthetic-secret", providerSpecificData: { importedToken: true } };
  try {
    await expect(getAccessToken("codebuddy-cn", credentials, {}, null, async () => {})).rejects.toThrow(/re-authenticate/i);
    await expect(refreshAccessToken("codebuddy-cn", credentials.refreshToken, credentials, {})).rejects.toThrow(/re-authenticate/i);
    await expect(new XaiExecutor("xai-oauth").refreshCredentials(credentials)).rejects.toThrow(/re-authenticate/i);
    expect(calls).toBe(0);
  } finally { globalThis.fetch = original; }
});

test("new generic imports advertise dormant refresh pairs", async () => {
  const { tokenImportProviders } = await import("../server/tokenImport.ts");
  for (const id of ["codebuddy-cn", "codebuddy-intl"]) {
    const entry: any = tokenImportProviders().find((item: any) => item.id === id);
    expect(entry.accessRefresh).toBe(true);
    expect(entry.refreshReason).toMatch(/cross-process/i);
    expect(entry.refreshReason).toMatch(/re-authenticate/i);
  }
});

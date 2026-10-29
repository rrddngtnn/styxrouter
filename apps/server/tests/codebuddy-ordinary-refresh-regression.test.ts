import { expect, test } from "bun:test";
import { refreshCodebuddyCnToken } from "../open-sse/services/tokenRefresh/providers/codebuddyCn.ts";
import { getAccessToken, refreshAccessToken } from "../open-sse/services/tokenRefresh.ts";
import { PROVIDERS } from "../open-sse/config/constants.ts";

process.env.STORAGE_ENCRYPTION_KEY = "synthetic-cbcn-ordinary-test-key";
process.env.STYX_TEST_MODE = "1";

async function connection(refreshToken: string) {
  const { createProviderConnection } = await import("../src/lib/db/providers.ts");
  const { getDbInstance } = await import("../src/lib/db/core.ts");
  const saved: any = await createProviderConnection({ provider: "codebuddy-cn", authType: "oauth", name: refreshToken, accessToken: "synthetic-old-access", refreshToken });
  return { saved, context: { db: getDbInstance(), connectionId: saved.id } };
}

async function assertStored(id: string, token: string) {
  const { getProviderConnectionById } = await import("../src/lib/db/providers.ts");
  expect((await getProviderConnectionById(id) as any).refreshToken).toBe(token);
}

test("ordinary CBCN generic OAuth refresh uses configured endpoint for both names", async () => {
  const originalFetch = globalThis.fetch;
  const previous = [PROVIDERS["codebuddy-cn"], PROVIDERS.cbcn];
  let calls = 0;
  globalThis.fetch = (async (url, options) => {
    calls++;
    expect(String(url)).toBe("https://synthetic.invalid/oauth/token");
    expect(new URLSearchParams(options?.body as string).get("refresh_token")).toBe(`synthetic-old-${calls}`);
    return Response.json({ access_token: "synthetic-new", refresh_token: `synthetic-rotated-${calls}`, expires_in: 3600 });
  }) as typeof fetch;
  try {
    for (const [index, provider] of ["codebuddy-cn", "cbcn"].entries()) {
      const old = `synthetic-old-${index + 1}`;
      const { saved, context } = await connection(old);
      PROVIDERS[provider] = { refreshUrl: "https://synthetic.invalid/oauth/token" } as any;
      expect(await refreshAccessToken(provider, old, { refreshContext: context }, null)).toEqual({
        accessToken: "synthetic-new", refreshToken: `synthetic-rotated-${index + 1}`, expiresIn: 3600, credentialsPersisted: true,
      });
      await assertStored(saved.id, `synthetic-rotated-${index + 1}`);
    }
    expect(calls).toBe(2);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [index, provider] of ["codebuddy-cn", "cbcn"].entries()) {
      if (previous[index] === undefined) delete PROVIDERS[provider];
      else PROVIDERS[provider] = previous[index];
    }
  }
}, 30000);

test("ordinary CBCN raw and orchestrated OAuth refresh returns rotated credentials", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (_url, options) => {
    calls++;
    expect(new Headers(options?.headers).get("X-Refresh-Token")).toBe(`synthetic-raw-old-${calls}`);
    return Response.json({ code: 0, data: { accessToken: "synthetic-new", refreshToken: `synthetic-raw-rotated-${calls}`, expiresIn: 3600 } });
  }) as typeof fetch;
  try {
    const first = await connection("synthetic-raw-old-1");
    const second = await connection("synthetic-raw-old-2");
    expect(await refreshCodebuddyCnToken("synthetic-raw-old-1", null, null, first.context)).toEqual({ accessToken: "synthetic-new", refreshToken: "synthetic-raw-rotated-1", expiresIn: 3600, credentialsPersisted: true });
    expect(await getAccessToken("codebuddy-cn", { refreshToken: "synthetic-raw-old-2", connectionId: second.saved.id }, null)).toEqual({ accessToken: "synthetic-new", refreshToken: "synthetic-raw-rotated-2", expiresIn: 3600, credentialsPersisted: true });
    await assertStored(first.saved.id, "synthetic-raw-rotated-1");
    await assertStored(second.saved.id, "synthetic-raw-rotated-2");
    expect(calls).toBe(2);
  } finally { globalThis.fetch = original; }
}, 30000);

test("explicit imported CBCN refresh is denied before network at generic entries", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls++; throw new Error("unexpected network"); }) as typeof fetch;
  const credentials = { refreshToken: "synthetic-old", providerSpecificData: { importedToken: true } };
  try {
    for (const provider of ["codebuddy-cn", "cbcn"]) {
      await expect(getAccessToken(provider, credentials, null)).rejects.toThrow(/imported credential refresh.*disabled/i);
      await expect(refreshAccessToken(provider, credentials.refreshToken, credentials, null)).rejects.toThrow(/imported credential refresh.*disabled/i);
    }
    expect(calls).toBe(0);
  } finally { globalThis.fetch = original; }
});
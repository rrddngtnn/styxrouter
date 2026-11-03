import "./helpers/test-secrets";
import { afterEach, expect, test } from "bun:test";
import { createAdminApi } from "../server/admin";
import { createProviderConnection, getProviderConnectionById, updateProviderConnection } from "../src/lib/db/providers";
import { acquireExclusiveConnectionLease } from "../src/lib/db/exclusiveConnectionLeases";
import { createApiKey } from "../src/lib/db/apiKeys";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; delete process.env.STYX_BLOCK_CODEX_REFRESH; });
const app = createAdminApi();
const refresh = (id: string) => app.request(`/connections/${id}/refresh-token`, { method: "POST" });
async function account(overrides: Record<string, unknown> = {}) {
  return createProviderConnection({ provider: "codex", authType: "oauth", name: crypto.randomUUID(), accessToken: "old-access", refreshToken: crypto.randomUUID(), ...overrides } as any);
}

test("disabled accounts are rejected without network or credential/health mutation", async () => {
  const conn = await account({ isActive: false });
  const before = await getProviderConnectionById(conn.id);
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return Response.json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 }); }) as typeof fetch;
  const response = await refresh(conn.id);
  expect(response.status).toBe(409);
  expect(calls).toBe(0);
  expect(await getProviderConnectionById(conn.id)).toEqual(before);
});

test("exclusive leased accounts reject unmanaged manual refresh", async () => {
  const conn = await account();
  const key = await createApiKey("refresh-lease", "test");
  expect(acquireExclusiveConnectionLease({ connectionId: conn.id, provider: "codex", apiKeyId: key.id, leaseOwnerId: `vlo_${"a".repeat(43)}` }).kind).toBe("ACQUIRED");
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return Response.json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 }); }) as typeof fetch;
  expect((await refresh(conn.id)).status).toBe(409);
  expect(calls).toBe(0);
});

test("concurrent credential replacement is never overwritten by manual refresh", async () => {
  const conn = await account();
  globalThis.fetch = (async () => {
    await updateProviderConnection(conn.id, { accessToken: "concurrent-access", refreshToken: "concurrent-refresh" });
    return Response.json({ access_token: "stale-access", refresh_token: "stale-refresh", expires_in: 3600 });
  }) as typeof fetch;
  expect((await refresh(conn.id)).status).toBe(400);
  const stored = await getProviderConnectionById(conn.id);
  expect(stored?.refreshToken).toBe("concurrent-refresh");
  expect(stored?.accessToken).toBe("concurrent-access");
});

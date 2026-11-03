import "./helpers/test-secrets";
import { afterEach, expect, mock, test } from "bun:test";
import { createProviderConnection, getProviderConnectionById, updateProviderConnection } from "../src/lib/db/providers";
import * as tokenRefresh from "../src/sse/services/tokenRefresh";

const realGetAccessToken = tokenRefresh.getAccessToken;
const realUpdateProviderCredentials = tokenRefresh.updateProviderCredentials;
let beforeRefresh: (credentials: any) => Promise<void> = async () => {};
// Insert a deterministic competing write after the HTTP snapshot, before the
// real helper's DB staleness check. All refresh and persistence logic stays real.
mock.module("../src/sse/services/tokenRefresh.ts", () => ({
  getAccessToken: async (provider: string, credentials: any, onPersist: any) => {
    await beforeRefresh(credentials);
    return realGetAccessToken(provider, credentials, onPersist);
  },
  updateProviderCredentials: realUpdateProviderCredentials,
}));
const { createAdminApi } = await import("../server/admin");
const app = createAdminApi();
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; beforeRefresh = async () => {}; });

test("manual refresh persists rotation after helper adopts a newer expired DB token", async () => {
  const conn = await createProviderConnection({ provider: "codex", authType: "oauth", name: crypto.randomUUID(), accessToken: "original-access", refreshToken: crypto.randomUUID() });
  const newerRefresh = crypto.randomUUID();
  const rotatedRefresh = crypto.randomUUID();
  beforeRefresh = async (credentials) => {
    expect(credentials.refreshToken).toBe(conn.refreshToken);
    await updateProviderConnection(conn.id, { accessToken: "newer-expired-access", refreshToken: newerRefresh, expiresAt: "2000-01-01T00:00:00.000Z" });
  };
  let calls = 0;
  globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
    calls++;
    expect(new URLSearchParams(String(init.body)).get("refresh_token")).toBe(newerRefresh);
    return Response.json({ access_token: "rotated-access", refresh_token: rotatedRefresh, expires_in: 3600 });
  }) as typeof fetch;
  const response = await app.request(`/connections/${conn.id}/refresh-token`, { method: "POST" });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ok: true });
  expect(calls).toBe(1);
  const stored = await getProviderConnectionById(conn.id);
  expect(stored?.refreshToken).toBe(rotatedRefresh);
  expect(stored?.accessToken).toBe("rotated-access");
});

test("manual refresh rejects unrelated replacement after adopting a newer expired token", async () => {
  const conn = await createProviderConnection({ provider: "codex", authType: "oauth", name: crypto.randomUUID(), accessToken: "original-access", refreshToken: crypto.randomUUID() });
  const newerRefresh = crypto.randomUUID();
  beforeRefresh = async () => {
    await updateProviderConnection(conn.id, { accessToken: "newer-expired-access", refreshToken: newerRefresh, expiresAt: "2000-01-01T00:00:00.000Z" });
  };
  let calls = 0;
  globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
    calls++;
    expect(new URLSearchParams(String(init.body)).get("refresh_token")).toBe(newerRefresh);
    // Even restoring the HTTP snapshot is a replacement of the actual input.
    await updateProviderConnection(conn.id, { accessToken: "replacement-access", refreshToken: conn.refreshToken });
    return Response.json({ access_token: "stale-access", refresh_token: crypto.randomUUID(), expires_in: 3600 });
  }) as typeof fetch;
  const response = await app.request(`/connections/${conn.id}/refresh-token`, { method: "POST" });
  expect(response.status).toBe(400);
  expect(calls).toBe(1);
  const stored = await getProviderConnectionById(conn.id);
  expect(stored?.refreshToken).toBe(conn.refreshToken);
  expect(stored?.accessToken).toBe("replacement-access");
});

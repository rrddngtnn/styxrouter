import { expect, test } from "bun:test";
process.env.STORAGE_ENCRYPTION_KEY = "synthetic-import-refresh-test-key";
process.env.CODEX_REFRESH_SPACING_MS = "0";

for (const provider of ["codex", "claude", "kimi-coding"]) {
  test(`${provider} refresh contract serializes concurrent calls and encrypts rotated credentials`, async () => {
    const { createProviderConnection, getProviderConnectionById } = await import("../src/lib/db/providers.ts");
    const { getAccessToken } = await import("../open-sse/services/tokenRefresh.ts");
    const { updateProviderCredentials } = await import("../src/sse/services/tokenRefresh.ts");
    const { getDbInstance } = await import("../src/lib/db/core.ts");
    const { PROVIDERS, OAUTH_ENDPOINTS } = await import("../open-sse/config/constants.ts");
    const oldRefresh = `synthetic-${provider}-refresh`;
    const connection: any = await createProviderConnection({ provider, name: `synthetic-${provider}`, authType: "oauth", accessToken: "synthetic-old-access", refreshToken: oldRefresh, expiresAt: new Date(0).toISOString(), providerSpecificData: {} });
    const credentials: any = { ...await getProviderConnectionById(connection.id), connectionId: connection.id };
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async (input, init) => {
      calls++;
      const endpoint = provider === "codex" ? OAUTH_ENDPOINTS.openai.token : provider === "claude" ? OAUTH_ENDPOINTS.anthropic.token : PROVIDERS[provider].refreshUrl;
      expect(String(input)).toBe(endpoint);
      expect(init?.method).toBe("POST");
      const headers = new Headers(init?.headers);
      expect(headers.get("content-type")).toBe("application/x-www-form-urlencoded");
      if (provider === "claude") expect(headers.get("anthropic-beta")).toBe("oauth-2025-04-20");
      if (provider === "kimi-coding") expect(headers.get("x-msh-device-id")).toBeTruthy();
      const params = new URLSearchParams(String(init?.body));
      expect(params.get("grant_type")).toBe("refresh_token");
      expect(params.get("refresh_token")).toBe(oldRefresh);
      expect(params.get("client_id")).toBe(PROVIDERS[provider].clientId);
      expect(params.has("scope")).toBe(false);
      await new Promise(resolve => setTimeout(resolve, 25));
      return Response.json({ access_token: "synthetic-new-access", refresh_token: "synthetic-new-refresh", expires_in: 3600 });
    }) as typeof fetch;
    try {
      const persist = async (result: any) => { expect(await updateProviderCredentials(connection.id, result)).toBe(true); };
      const results = await Promise.all([getAccessToken(provider, { ...credentials }, {}, null, persist), getAccessToken(provider, { ...credentials }, {}, null, persist)]);
      expect(calls).toBe(1);
      expect(results.map(result => result.accessToken)).toEqual(["synthetic-new-access", "synthetic-new-access"]);
      const saved: any = await getProviderConnectionById(connection.id);
      expect(saved.accessToken).toBe("synthetic-new-access");
      expect(saved.refreshToken).toBe("synthetic-new-refresh");
      expect(new Date(saved.expiresAt).getTime()).toBeGreaterThan(Date.now());
      const raw: any = getDbInstance().prepare("SELECT access_token, refresh_token FROM provider_connections WHERE id = ?").get(connection.id);
      expect(raw.access_token).toStartWith("enc:v1:");
      expect(raw.refresh_token).toStartWith("enc:v1:");
      expect(JSON.stringify(raw)).not.toContain("synthetic-");
      globalThis.fetch = (async () => new Response("synthetic-upstream-secret", { status: 500 })) as typeof fetch;
      expect(await getAccessToken(provider, { ...saved, connectionId: connection.id }, {}, null, persist)).toBeNull();
      const afterFailure: any = await getProviderConnectionById(connection.id);
      expect(afterFailure.accessToken).toBe(saved.accessToken);
      expect(afterFailure.refreshToken).toBe(saved.refreshToken);
    } finally { globalThis.fetch = original; }
  }, 30000);
}

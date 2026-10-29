import { expect, test } from "bun:test";
import { prepareTokenImport, tokenImportProviders } from "../server/tokenImport.ts";

const entry = (provider: string, extra: Record<string, unknown> = {}) =>
  prepareTokenImport({ provider, accounts: { access_token: "synthetic-access", ...extra } })![0].view;

test("provider metadata rejects incompatible and unverified contracts", () => {
  const providers = new Map(tokenImportProviders().map((p) => [p.id, p]));
  for (const id of ["chatgpt-web-codex", "lmarena", "gemini-web", "github", "antigravity"]) {
    expect(providers.get(id)).toMatchObject({ supported: false, reason: expect.any(String) });
    expect(entry(id).valid).toBe(false);
  }
  expect(providers.get("codebuddy-cn")).toMatchObject({ supported: true, access: true, accessRefresh: true, json: true });
  expect(providers.get("kimi-web")).toMatchObject({ supported: true, access: true, accessRefresh: false, json: true });
  expect(providers.get("kiro")).toMatchObject({ supported: true, access: true, accessRefresh: false, json: true });
  expect(entry("kiro").valid).toBe(false);
  expect(providers.get("openai")).toMatchObject({ supported: true, access: true, accessRefresh: false, json: true });
});

test("imported non-refreshable credentials never trigger proactive executor refresh", async () => {
  const { CodeBuddyCnExecutor } = await import("../open-sse/executors/codebuddy-cn.ts");
  const executor = new CodeBuddyCnExecutor();
  expect(executor.needsRefresh({ accessToken: "synthetic-near-expiry", expiresAt: new Date(Date.now() + 1000).toISOString(), providerSpecificData: { importedToken: true, nonRefreshable: true } })).toBe(false);
  expect(executor.needsRefresh({ accessToken: "synthetic-refreshable", refreshToken: "synthetic-refresh", expiresAt: new Date(Date.now() + 1000).toISOString(), providerSpecificData: { importedToken: true, nonRefreshable: false } })).toBe(true);
});

test("CodeBuddy International access and refresh are supported without leaking upstream errors", async () => {
  const providers = new Map(tokenImportProviders().map((p) => [p.id, p]));
  expect(providers.get("codebuddy-intl")).toMatchObject({ supported: true, access: true, accessRefresh: true, authType: "oauth" });
  expect(entry("codebuddy-intl", { refresh_token: "synthetic-refresh" })).toMatchObject({ valid: true, refreshable: false });
  const { refreshCodebuddyIntlToken } = await import("../open-sse/services/tokenRefresh/providers/codebuddyIntl.ts");
  const original = globalThis.fetch;
  const messages: unknown[] = [];
  globalThis.fetch = (async () => new Response("synthetic-secret-in-error", { status: 401 })) as typeof fetch;
  try {
    expect(await refreshCodebuddyIntlToken("synthetic-refresh", { error: (...args: unknown[]) => messages.push(args) } as any)).toBeNull();
    expect(JSON.stringify(messages)).not.toContain("synthetic-secret-in-error");
    globalThis.fetch = (async () => { throw new Error("synthetic-secret-in-exception"); }) as typeof fetch;
    expect(await refreshCodebuddyIntlToken("synthetic-refresh", { error: (...args: unknown[]) => messages.push(args) } as any)).toBeNull();
    expect(JSON.stringify(messages)).not.toContain("synthetic-secret-in-exception");
  } finally { globalThis.fetch = original; }
});

test("CodeBuddy International refresh rejects malformed token payloads without echoing them", async () => {
  const { refreshCodebuddyIntlToken } = await import("../open-sse/services/tokenRefresh/providers/codebuddyIntl.ts");
  const original = globalThis.fetch;
  const messages: unknown[] = [];
  globalThis.fetch = (async () => Response.json({ code: 0, data: { refreshToken: "synthetic-secret" } })) as typeof fetch;
  try {
    expect(await refreshCodebuddyIntlToken("synthetic-refresh", { error: (...args: unknown[]) => messages.push(args) } as any)).toBeNull();
    expect(JSON.stringify(messages)).not.toContain("synthetic-secret");
  } finally { globalThis.fetch = original; }
});

test("CodeBuddy International non-imported pair rotates encrypted credentials through the refresh service", async () => {
  process.env.STORAGE_ENCRYPTION_KEY = "import-compatibility-test-key";
  const { createProviderConnection, getProviderConnectionById } = await import("../src/lib/db/providers.ts");
  const { getAccessToken } = await import("../open-sse/services/tokenRefresh.ts");
  const { updateProviderCredentials } = await import("../src/sse/services/tokenRefresh.ts");
  const saved: any = await createProviderConnection({ provider: "codebuddy-intl", authType: "oauth", name: "synthetic-intl", accessToken: "synthetic-intl-old", refreshToken: "synthetic-intl-refresh", expiresAt: new Date(0).toISOString() });
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: any, options: any) => {
    expect(new Headers(options.headers).get("X-Refresh-Token")).toBe("synthetic-intl-refresh");
    return Response.json({ code: 0, data: { accessToken: "synthetic-intl-new", refreshToken: "synthetic-intl-rotated", expiresIn: 3600 } });
  }) as typeof fetch;
  try {
    const old: any = await getProviderConnectionById(saved.id);
    const result = await getAccessToken("codebuddy-intl", { ...old, connectionId: saved.id }, {}, null, async (value: any) => { expect(await updateProviderCredentials(saved.id, value)).toBe(true); });
    expect(result.accessToken).toBe("synthetic-intl-new");
    const after: any = await getProviderConnectionById(saved.id);
    expect(after.accessToken).toBe("synthetic-intl-new");
    expect(after.refreshToken).toBe("synthetic-intl-rotated");
  } finally { globalThis.fetch = original; }
}, 30000);

test("rejects refresh tokens when the selected contract cannot refresh them", () => {
  expect(entry("openai", { refresh_token: "synthetic-refresh" }).valid).toBe(false);
  expect(entry("codebuddy-cn", { refresh_token: "synthetic-refresh" })).toMatchObject({ valid: true, refreshable: false });
});

import { expect, test } from "bun:test";
process.env.STORAGE_ENCRYPTION_KEY = "synthetic-import-security-test-key";
process.env.STYX_TEST_MODE = "1";

const { prepareTokenImport, saveTokenImport } = await import("../server/tokenImport.ts");
const { getProviderConnectionById, getProviderConnections } = await import("../src/lib/db/providers.ts");
const { getProviderCredentials } = await import("../src/sse/services/auth.ts");
const { CodexExecutor } = await import("../open-sse/executors/codex.ts");
const prepare = (account: unknown, provider = "codebuddy-cn") => prepareTokenImport({ provider, accounts: account })!;

test("all explicit provider and host indicators must agree and unknown hosts cannot fall back", async () => {
  const cases = [
    { provider: "codebuddy-cn", credentials: { providerId: "openai", token: "synthetic-a" } },
    { provider: "codebuddy-cn", providerId: "synthetic-unknown-provider", token: "synthetic-b" },
    { token: "synthetic-c", url: "https://synthetic-unknown.invalid/path" },
    { token: "synthetic-d", url: "not-a-url" },
    { provider: "codebuddy-cn", token: "synthetic-e", url: "https://api.openai.com/v1" },
    { token: "synthetic-f", baseUrl: "https://copilot.tencent.com", auth: { url: "https://synthetic-unknown.invalid" } },
  ];
  const before = (await getProviderConnections()).length;
  let audits = 0;
  for (const account of cases) {
    const items = prepare(account);
    expect(items[0].view.valid).toBe(false);
    const saved = await saveTokenImport(items, () => audits++);
    expect(saved[0].valid).toBe(false);
    expect(JSON.stringify(saved)).not.toContain("synthetic-");
  }
  expect(audits).toBe(0);
  expect((await getProviderConnections()).length).toBe(before);
  expect(prepare({ token: "synthetic-valid" })[0].view).toMatchObject({ valid: true, providerSource: "fallback" });
  expect(prepare({ token: "synthetic-valid", url: "https://copilot.tencent.com/v2" })[0].view).toMatchObject({ valid: true, providerSource: "host" });
  expect(prepare({ provider: "codex", token: "synthetic-valid", url: "https://chatgpt.com/backend-api/codex/responses" })[0].view).toMatchObject({ valid: true, provider: "codex" });
  expect(prepare({ token: "synthetic-valid", url: "https://chatgpt.com" }, "codex")[0].view.valid).toBe(false);
});

test("ambiguous or cross-wrapper refresh pairs never save or dispatch", async () => {
  const cases = [
    { access_token: "synthetic-access-one", tokens: { access_token: "synthetic-access-two", refresh_token: "synthetic-refresh-two" } },
    { tokens: { access_token: "synthetic-access-one" }, credentials: { refresh_token: "synthetic-refresh-two" } },
    { tokens: { access_token: "synthetic-access-one", refresh_token: "synthetic-refresh-one" }, auth: { refreshToken: "synthetic-refresh-two" } },
    { access_token: "synthetic-access-one", accessToken: "synthetic-access-two" },
  ];
  const before = (await getProviderConnections()).length;
  let audits = 0, network = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async () => { network++; throw new Error("unexpected network"); }) as typeof fetch;
  try {
    for (const account of cases) {
      const items = prepare(account);
      expect(items[0].view.valid).toBe(false);
      const saved = await saveTokenImport(items, () => audits++);
      expect(saved[0].valid).toBe(false);
      expect(JSON.stringify(saved)).not.toContain("synthetic-");
    }
    expect((await getProviderConnections()).length).toBe(before);
    expect(audits).toBe(0);
    expect(network).toBe(0);
    expect(prepare({ tokens: { access_token: "synthetic-access", refresh_token: "synthetic-refresh" } })[0].view).toMatchObject({ valid: true, refreshable: false });
  } finally { globalThis.fetch = original; }
});

test("Codex CLI workspace id survives import and is sent on the actual request", async () => {
  const items = prepare({ tokens: { access_token: "synthetic-codex-access", account_id: "workspace-synthetic-123" } }, "codex");
  const result: any = (await saveTokenImport(items, () => {}))[0];
  expect(result.valid).toBe(true);
  expect(JSON.stringify(result)).not.toContain("workspace-synthetic-123");
  const row: any = await getProviderConnectionById(result.id);
  expect(row.providerSpecificData.workspaceId).toBe("workspace-synthetic-123");
  const creds: any = await getProviderCredentials("codex", null, [result.id]);
  let headers: Headers | undefined;
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url, options) => { headers = new Headers(options?.headers); return new Response("data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } }); }) as typeof fetch;
  try {
    const out: any = await new CodexExecutor().execute({ model: "gpt-5.5", body: { model: "gpt-5.5", input: "hi" }, stream: true, credentials: creds });
    expect(out.response.status).toBe(200);
    expect(headers?.get("chatgpt-account-id")).toBe("workspace-synthetic-123");
    expect(headers?.get("authorization")).toBe("Bearer synthetic-codex-access");
  } finally { globalThis.fetch = original; }
}, 30000);

test("Codex workspace metadata rejects conflicts and invalid identifiers", () => {
  expect(prepare({ access_token: "synthetic-access", providerSpecificData: { workspaceId: "workspace-id" } }, "codex")[0]).toMatchObject({ workspaceId: "workspace-id", view: { valid: true } });
  expect(prepare({ account_id: "workspace-id", tokens: { access_token: "synthetic-access" } }, "codex")[0]).toMatchObject({ workspaceId: "workspace-id", view: { valid: true } });
  for (const account of [
    { access_token: "synthetic-access", account_id: "bad\r\nheader" },
    { access_token: "synthetic-access", workspaceId: "id-one", tokens: { account_id: "id-two" } },
    { access_token: "synthetic-access", account_id: { secret: "synthetic-secret" } },
    { tokens: { access_token: "synthetic-access" }, credentials: { account_id: "unrelated-workspace" } },
  ]) {
    const view = prepare(account, "codex")[0].view;
    expect(view.valid).toBe(false);
    expect(JSON.stringify(view)).not.toContain("synthetic-");
  }
});

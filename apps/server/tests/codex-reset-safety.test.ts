import { afterAll, beforeEach, expect, mock, test } from "bun:test";

const originalFetch = globalThis.fetch;
let refreshFails = false;
let frozen = false;
let posts: Array<Record<string, string>> = [];
let inventory: unknown = { credits: [{ id: "first" }, { id: "second" }] };
let postResponses: Array<Response | Error> = [];
mock.module("@/lib/localDb", () => ({
  getProviderConnectionById: async (id: string) => ({ id, provider: "codex", authType: "oauth", accessToken: "synthetic" }),
  resolveProxyForConnection: async () => null,
}));
mock.module("@/lib/exclusiveLeaseIsolation", () => ({ isConnectionUnavailableToAuxiliaryActivity: async () => frozen }));
mock.module("@/lib/usage/providerLimits", () => ({
  refreshAndUpdateCredentials: async (connection: unknown) => ({ connection }),
  fetchAndPersistProviderLimits: async () => { if (refreshFails) throw new Error("synthetic refresh failure"); return { usage: { quotas: {} } }; },
}));
mock.module("@styxrouter/open-sse/services/codexQuotaFetcher.ts", () => ({ invalidateCodexQuotaCache: () => {} }));
mock.module("@styxrouter/open-sse/utils/proxyFetch.ts", () => ({ runWithProxyContext: (_: unknown, fn: () => unknown) => fn() }));
const { consumeCodexResetCredit, listCodexResetCredits } = await import("../src/lib/usage/codexResetCredits");
beforeEach(() => {
  refreshFails = false; frozen = false; posts = []; postResponses = [];
  inventory = { credits: [{ id: "first" }, { id: "second" }] };
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    if (init?.method !== "POST") return Response.json(inventory);
    posts.push(JSON.parse(String(init.body)));
    const next = postResponses.shift();
    if (next instanceof Error) throw next;
    return next ?? Response.json({ outcome: "reset" });
  }) as typeof fetch;
});
afterAll(() => { globalThis.fetch = originalFetch; mock.restore(); });
test("confirmed consume remains successful when the quota refresh fails", async () => {
  refreshFails = true;
  const result = await consumeCodexResetCredit("refresh-failure", "request-1", "first");
  expect(result.outcome).toBe("reset");
  expect(result).toMatchObject({ usage: null, quotaRefreshed: false });
  expect(posts).toHaveLength(1);
});
test("same request replays a confirmed result without selecting another credit", async () => {
  await consumeCodexResetCredit("replay", "same-key");
  inventory = { credits: [{ id: "second" }] };
  await consumeCodexResetCredit("replay", "same-key");
  expect(posts).toHaveLength(1);
});
test("uncertain retry pins the original credit even when inventory changes", async () => {
  postResponses = [new Error("synthetic lost response")];
  await expect(consumeCodexResetCredit("uncertain", "same-key")).rejects.toThrow();
  inventory = { credits: [{ id: "second" }] };
  await consumeCodexResetCredit("uncertain", "same-key");
  expect(posts.map(p => p.credit_id)).toEqual(["first", "first"]);
});
test("null inventory count stays unknown rather than becoming zero", async () => {
  inventory = { available_count: null };
  expect((await listCodexResetCredits("unknown-count")).availableCount).toBeNull();
});
test("parallel spends on one account are rejected before a second POST", async () => {
  const first = consumeCodexResetCredit("parallel", "one", "first");
  await expect(consumeCodexResetCredit("parallel", "two", "second")).rejects.toMatchObject({ code: "redemption_in_progress" });
  await first;
  expect(posts).toHaveLength(1);
});
test("a replay cannot bypass a new exclusive lease", async () => {
  await consumeCodexResetCredit("freeze", "one", "first");
  frozen = true;
  await expect(consumeCodexResetCredit("freeze", "one", "first")).rejects.toMatchObject({ code: "exclusive_lease_active" });
  expect(posts).toHaveLength(1);
});
test("reusing a request key for another credit is rejected", async () => {
  await consumeCodexResetCredit("conflict", "one", "first");
  await expect(consumeCodexResetCredit("conflict", "one", "second")).rejects.toMatchObject({ code: "idempotency_conflict" });
  expect(posts).toHaveLength(1);
});

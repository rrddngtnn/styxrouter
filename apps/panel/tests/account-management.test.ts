import { expect, test } from "bun:test";
import { accountsForProvider, groupAccounts, resolveProviderTarget, runBulk, selectedAccounts } from "../src/lib/account-management.ts";

test("selection excludes stale IDs", () => {
  expect(selectedAccounts([{ id: "a" }, { id: "b" }], new Set(["a", "stale"]))).toEqual(["a"]);
});

test("bulk requests are sequential and failures are safe and partial", async () => {
  let active = 0;
  const calls: string[] = [];
  const result = await runBulk(["a", "b", "c"], "test", async (method, path) => {
    expect(active++).toBe(0);
    calls.push(method + " " + path);
    await Promise.resolve();
    active--;
    if (path.includes("/b/")) throw new Error("SECRET");
    return { ok: !path.includes("/c/") };
  });
  expect(calls).toEqual(["POST /api/connections/a/test", "POST /api/connections/b/test", "POST /api/connections/c/test"]);
  expect(result.map(r => r.ok)).toEqual([true, false, false]);
  expect(JSON.stringify(result)).not.toContain("SECRET");
});

test("bulk mutations use existing account endpoints", async () => {
  const calls: unknown[] = [];
  for (const action of ["enable", "disable", "cooldown", "delete"] as const) {
    await runBulk(["a/b"], action, async (...args) => { calls.push(args); return {}; });
  }
  expect(calls).toEqual([
    ["PATCH", "/api/connections/a%2Fb", { isActive: true }],
    ["PATCH", "/api/connections/a%2Fb", { isActive: false }],
    ["POST", "/api/connections/a%2Fb/release-cooldown", undefined],
    ["DELETE", "/api/connections/a%2Fb", undefined],
  ]);
});

test("groups only current auth bucket and uses custom human labels", () => {
  const accounts = [{ id: "a", provider: "dual", authType: "oauth" }, { id: "b", provider: "dual", authType: "api_key" }, { id: "c", provider: "node", authType: "apikey" }];
  const providers = [{ id: "dual", name: "Dual", authModes: ["oauth", "apikey"] }];
  const nodes = [{ id: "node", name: "My endpoint", prefix: "mine" }];
  expect(groupAccounts(accounts, providers, nodes, "oauth").map(g => g.accounts.map(a => a.id))).toEqual([["a"]]);
  expect(groupAccounts(accounts, providers, nodes, "apikey")[0]?.accounts.map(a => a.id)).toEqual(["b"]);
  expect(groupAccounts(accounts, providers, nodes, "custom")[0]?.label).toBe("My endpoint (mine)");
});

test("resolveProviderTarget and accountsForProvider isolate a single provider or custom node for the detail page", () => {
  const providers = [
    { id: "antigravity", name: "Antigravity", vendor: "google", authType: "oauth", authModes: ["oauth"] },
    { id: "glm", name: "GLM (Z.ai Coding / Start Plan)", vendor: "zhipu", authType: "apikey", authModes: ["oauth", "apikey"] },
  ];
  const nodes = [
    { id: "openai-compatible-chat-112e", name: "Muse Bridge", prefix: "muse", type: "openai-compatible", apiType: "chat", baseUrl: "http://localhost:20130/v1" },
  ];
  const accounts = [
    { id: "2", provider: "glm", name: "zeta-key", authType: "apikey" },
    { id: "1", provider: "glm", name: "alpha-oauth", authType: "oauth" },
    { id: "3", provider: "antigravity", name: "ag-user", authType: "oauth" },
    { id: "4", provider: "openai-compatible-chat-112e", name: "muse-conn", authType: "apikey" },
  ];

  const glmTarget = resolveProviderTarget("glm", providers, nodes);
  expect(glmTarget).toMatchObject({
    id: "glm",
    label: "GLM (Z.ai Coding / Start Plan)",
    badge: "zhipu",
    isCustomNode: false,
    canOauth: true,
    canApiKey: true,
    defaultTab: "oauth",
  });
  expect(accountsForProvider(accounts, "glm").map((a) => a.name)).toEqual(["alpha-oauth", "zeta-key"]);

  const nodeTarget = resolveProviderTarget("openai-compatible-chat-112e", providers, nodes);
  expect(nodeTarget).toMatchObject({
    id: "openai-compatible-chat-112e",
    label: "Muse Bridge",
    code: "muse/*",
    badge: "openai",
    isCustomNode: true,
    canOauth: false,
    canApiKey: true,
    defaultTab: "custom",
  });
  expect(accountsForProvider(accounts, "openai-compatible-chat-112e").map((a) => a.name)).toEqual(["muse-conn"]);

  expect(resolveProviderTarget("nonexistent", providers, nodes)).toBeNull();
});

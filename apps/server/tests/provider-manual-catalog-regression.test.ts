import { afterAll, beforeAll, expect, test } from "bun:test";
import { startTestServer } from "./helpers/start-test-server";
import { createProviderConnection, createProviderNode, getRawProviderConnections } from "../src/lib/db/providers";
import { addCustomModel, replaceSyncedAvailableModelsForConnection } from "../src/lib/db/models";
import { REGISTRY } from "../open-sse/config/providerRegistry";
import { buildAliasMaps } from "../src/app/api/v1/models/catalogProviderMaps";

let base = "", cookie = "", nodeId = "";
let proc: any;
const password = "manual-catalog-fixture-password";
const call = (method: string, path: string, body?: unknown) => fetch(base + path, {
  method, headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const catalog = async (mode: string) => {
  const response = await call("GET", `/v1/models?prefix=${mode}`);
  expect(response.status).toBe(200);
  return ((await response.json()) as any).data as any[];
};
const families = ["openai", "gemini", "kimi-web", "claude"];
const legacyFamilies = ["reka", "chatgpt-web", "zai-web", "cursor"];

beforeAll(async () => {
  for (const provider of [...families, ...legacyFamilies]) {
    const connection = await createProviderConnection({ provider, authType: "apikey", apiKey: "fixture-key", name: `${provider} fixture`, isActive: true } as any);
    if (provider === "cursor") {
      await replaceSyncedAvailableModelsForConnection(provider, connection.id, [{ id: "cursor-live-fixture", name: "Live", supportsVision: true }]);
    }
    if (legacyFamilies.includes(provider)) await addCustomModel(provider, `manual-${provider}`, `Manual ${provider}`);
    if (["gemini", "reka", "chatgpt-web", "kimi-web", "zai-web"].includes(provider)) await addCustomModel(provider, `imported-${provider}`, "Imported", "auto-sync");
  }
  const claudeRows = await getRawProviderConnections({ provider: "claude", isActive: true });
  await addCustomModel("claude", "overlap-fixture", "Manual overlay", "manual", "chat-completions", ["chat"], undefined, {}, true);
  await replaceSyncedAvailableModelsForConnection("claude", claudeRows[0].id, [{ id: "overlap-fixture", name: "Synced", supportedThinkingEfforts: ["low", "high"] }]);
  await addCustomModel("gemini", "gemini-overlap", "Manual Gemini", "manual", "embeddings", ["embeddings"]);
  const geminiRows = await getRawProviderConnections({ provider: "gemini", isActive: true });
  await replaceSyncedAvailableModelsForConnection("gemini", geminiRows[0].id, [{ id: "gemini-overlap", name: "Synced" }]);
  const node: any = await createProviderNode({ type: "openai-compatible", name: "Fixture", prefix: "manualnode", apiType: "chat", baseUrl: "https://example.com" });
  nodeId = node.id;
  await createProviderConnection({ provider: nodeId, authType: "apikey", apiKey: "fixture-key", name: "node fixture", isActive: true } as any);
  ({ proc, base } = await startTestServer(process.execPath, { cwd: new URL("..", import.meta.url).pathname, env: { ...process.env, STYX_TEST_MODE: "1", JWT_SECRET: "manual-catalog-jwt-secret-0123456789", API_KEY_SECRET: "manual-catalog-key-secret-0123456789", INITIAL_PASSWORD: password } }));
  const login = await fetch(base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
  expect(login.status).toBe(200);
  cookie = (login.headers.get("set-cookie") || "").split(";")[0];
}, 60000);
afterAll(async () => { if (proc && proc.exitCode === null) { const done = new Promise(resolve => proc.once("exit", resolve)); proc.kill("SIGKILL"); await done; } });

test("manual CRUD models are served once for each provider family and prefix mode", async () => {
  for (const provider of families) {
    const response = await call("POST", `/api/providers/${provider}/models`, { id: `manual-${provider}`, name: `Manual ${provider}` });
    expect([provider, response.status]).toEqual([provider, 201]);
  }
  expect((await call("POST", `/api/providers/${nodeId}/models`, { id: "vendor/manual-node", inputTokenLimit: 4096, outputTokenLimit: 1024, supportsVision: true })).status).toBe(201);
  expect((await call("PATCH", "/api/settings", { blockedProviders: ["gemini"] })).status).toBe(200);
  expect((await catalog("canonical")).some(row => row.id === "gemini/manual-gemini")).toBe(false);
  expect((await call("PATCH", "/api/settings", { blockedProviders: [] })).status).toBe(200);
  for (const mode of ["canonical", "alias", "dual"]) {
    const rows = await catalog(mode);
    for (const provider of ["gemini", "reka", "chatgpt-web", "kimi-web", "zai-web"]) expect(rows.some(row => row.root === `imported-${provider}`)).toBe(false);
    const nodeRow = rows.find(row => row.id === "manualnode/vendor/manual-node");
    expect(nodeRow).toMatchObject({ max_input_tokens: 4096, max_output_tokens: 1024, capabilities: { vision: true } });
    expect(rows.filter(row => row.id === "manualnode/vendor/manual-node").length).toBe(1);
    for (const provider of legacyFamilies) {
      const alias = buildAliasMaps().providerIdToAlias[provider] || provider;
      const prefixes = new Set(mode === "dual" ? [provider, alias] : [mode === "alias" ? alias : provider]);
      for (const prefix of prefixes) expect([mode, prefix, rows.filter(row => row.id === `${prefix}/manual-${provider}`).length]).toEqual([mode, prefix, 1]);
    }
    for (const provider of families) {
      const alias = REGISTRY[provider].alias || provider;
      const expected = new Set(mode === "dual" ? [provider, alias] : [mode === "alias" ? alias : provider]);
      for (const prefix of expected) {
        const id = `${prefix}/manual-${provider}`;
        expect([mode, id, rows.filter(row => row.id === id).length]).toEqual([mode, id, 1]);
      }
    }
    const geminiOverlap = rows.filter(row => row.id === "gemini/gemini-overlap");
    expect(geminiOverlap.length).toBe(1);
    expect(geminiOverlap[0].type).toBe("embedding");
    const overlap = rows.filter(row => row.id === (mode === "alias" ? "cc/overlap-fixture" : "claude/overlap-fixture"));
    expect(overlap.length).toBe(1);
    expect(overlap[0].custom).toBe(true);
    expect(overlap[0].capabilities.vision).toBe(true);
    if (mode === "dual") {
      const aliasOverlap = rows.filter(row => row.id === "cc/overlap-fixture");
      expect(aliasOverlap.length).toBe(1);
      expect(aliasOverlap[0].custom).toBe(true);
      expect(aliasOverlap[0].capabilities.effort_tiers).toEqual(["low", "high"]);
    }
    expect(overlap[0].capabilities.effort_tiers).toEqual(["low", "high"]);
    expect(rows.some(row => row.id.endsWith("/cursor-live-fixture"))).toBe(true);
  }
  const nodePath = `/api/providers/${nodeId}/models/${encodeURIComponent("vendor/manual-node")}`;
  expect((await call("PATCH", nodePath, { inputTokenLimit: 8192, outputTokenLimit: 2048, supportsVision: false })).status).toBe(200);
  const updatedNode = (await catalog("canonical")).find(row => row.id === "manualnode/vendor/manual-node");
  expect(updatedNode).toMatchObject({ context_length: 8192, max_input_tokens: 8192, max_output_tokens: 2048, capabilities: { vision: false } });
  expect((await call("PATCH", nodePath, { inputTokenLimit: null, outputTokenLimit: null, supportsVision: null })).status).toBe(200);
  const clearedNode = (await catalog("canonical")).find(row => row.id === "manualnode/vendor/manual-node");
  expect(clearedNode.context_length).toBe(1_000_000);
  expect(clearedNode.max_input_tokens).toBe(1_000_000);
  for (const provider of families) {
    const path = `/api/providers/${provider}/models/manual-${provider}`;
    expect((await call("PATCH", path, { apiFormat: "embeddings", supportedEndpoints: ["embeddings"] })).status).toBe(200);
    const rows = await catalog("canonical");
    const entry = rows.find(row => row.id === `${provider}/manual-${provider}`);
    expect(entry?.type).toBe("embedding");
    expect(entry?.api_format).toBe("embeddings");
    expect(entry?.supported_endpoints).toEqual(["embeddings"]);
    expect((await call("DELETE", path)).status).toBe(200);
    expect((await catalog("canonical")).some(row => row.id === `${provider}/manual-${provider}`)).toBe(false);
  }
}, 120000);

import { afterEach, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "styx-antigravity-catalog-"));
process.env.STYX_TEST_MODE = "1";

const { replaceSyncedAvailableModelsForConnection } = await import("../src/lib/db/models.ts");
const { getProviderCredentials, loadAdvertisedModelsForSelfHostedConnections, markAccountUnavailable } = await import("../src/sse/services/auth.ts");
const { isModelAdvertisedByConnection } = await import("../src/domain/connectionModelRules.ts");
const { clearAllModelLockouts, isModelLocked } = await import("../open-sse/services/accountFallback.ts");
const { AntigravityExecutor } = await import("../open-sse/executors/antigravity.ts");
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearAllModelLockouts();
});

function executorInput(model: string) {
  return {
    model,
    body: { contents: [{ role: "user", parts: [{ text: "hello" }] }] },
    stream: true,
    credentials: { accessToken: "synthetic-access", projectId: "synthetic-project" },
    log: { debug() {}, info() {}, warn() {}, error() {} },
  } as any;
}

test("Antigravity executor never rewrites a newer Claude request to a lower model", async () => {
  const dispatched: string[] = [];
  globalThis.fetch = (async (url, init) => {
    if (String(url).includes("auto-updater")) return Response.json([{ version: "1.0.0" }]);
    dispatched.push(JSON.parse(await new Response(init?.body as BodyInit).text()).model);
    return Response.json({ error: { message: "The requested model is not supported" } }, { status: 400 });
  }) as typeof fetch;

  const result = await new AntigravityExecutor().execute(executorInput("claude-opus-5-5"));

  expect(result.response.status).toBe(400);
  expect(dispatched).toEqual(["claude-opus-5-5-medium"]);
});

test("mixed Antigravity catalogs exclude an account lacking newer models and retain the same-model engine", async () => {
  const { createProviderConnection } = await import("../src/lib/db/providers.ts");
  const olderEngine = await createProviderConnection({ provider: "antigravity", authType: "oauth", accessToken: "synthetic-old", projectId: "old-project", isActive: true, name: "Older engine" } as any);
  const newerEngine = await createProviderConnection({ provider: "antigravity", authType: "oauth", accessToken: "synthetic-new", projectId: "new-project", isActive: true, name: "Newer engine" } as any);
  await replaceSyncedAvailableModelsForConnection("antigravity", olderEngine.id, [
    { id: "claude-opus-4-6-thinking", name: "Claude Opus 4.6 (Thinking)" },
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
  ]);
  await replaceSyncedAvailableModelsForConnection("antigravity", newerEngine.id, [
    { id: "claude-opus-4-6-thinking", name: "Claude Opus 4.6 (Thinking)" },
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
    { id: "claude-opus-5-5-medium", name: "Claude Opus 5.5 (Medium)" },
    { id: "gemini-4-argon-medium", name: "Gemini 4 Argon (Medium)" },
  ]);

  const inventory = await loadAdvertisedModelsForSelfHostedConnections([
    { id: olderEngine.id, provider: "antigravity" },
    { id: newerEngine.id, provider: "antigravity" },
  ] as any, "claude-opus-5-5-medium");
  const selected = await getProviderCredentials("antigravity", olderEngine.id, [olderEngine.id, newerEngine.id], "claude-opus-5-5-medium");

  expect(inventory.get(olderEngine.id)?.has("claude-opus-5-5-medium")).toBe(false);
  expect(inventory.get(newerEngine.id)?.has("claude-opus-5-5-medium")).toBe(true);
  expect(inventory.get(olderEngine.id)?.has("gemini-4-argon-medium")).toBe(false);
  expect(inventory.get(newerEngine.id)?.has("gemini-4-argon-medium")).toBe(true);
  expect(selected?.connectionId).toBe(newerEngine.id);
  expect(selected?.accessToken).toBe("synthetic-new");
});

test("known catalogs with no account advertising the exact requested model return no same-provider candidate", async () => {
  const { createProviderConnection } = await import("../src/lib/db/providers.ts");
  const legacy = await createProviderConnection({ provider: "antigravity", authType: "oauth", accessToken: "synthetic-legacy", projectId: "legacy-project", isActive: true, name: "Legacy only" } as any);
  await replaceSyncedAvailableModelsForConnection("antigravity", legacy.id, [
    { id: "claude-opus-4-6-thinking", name: "Claude Opus 4.6 (Thinking)" },
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
  ]);

  const selected = await getProviderCredentials("antigravity", null, [legacy.id], "claude-opus-5-5-medium");

  expect(selected).toBeNull();
});

test("unsupported upstream model rejection locks only that account-model tuple and rotates to another account with the same model", async () => {
  const { createProviderConnection } = await import("../src/lib/db/providers.ts");
  const unsupported = await createProviderConnection({ provider: "antigravity", authType: "oauth", accessToken: "synthetic-unsupported", projectId: "unsupported-project", isActive: true, name: "Unsupported" } as any);
  const eligible = await createProviderConnection({ provider: "antigravity", authType: "oauth", accessToken: "synthetic-eligible", projectId: "eligible-project", isActive: true, name: "Eligible" } as any);

  await markAccountUnavailable(unsupported.id, 400, "The requested model is not supported", "antigravity", "claude-opus-5-5-medium");

  expect(isModelLocked("antigravity", unsupported.id, "claude-opus-5-5-medium")).toBe(true);
  expect(isModelLocked("antigravity", unsupported.id, "claude-opus-4-6-thinking")).toBe(false);
  const selected = await getProviderCredentials("antigravity", null, [unsupported.id, eligible.id], "claude-opus-5-5-medium");
  expect(selected?.connectionId).toBe(eligible.id);
});

test("quota and authentication failures do not use the unsupported-model classifier", async () => {
  const { createProviderConnection } = await import("../src/lib/db/providers.ts");
  const quota = await createProviderConnection({ provider: "antigravity", authType: "oauth", accessToken: "synthetic-quota", projectId: "quota-project", isActive: true, name: "Quota" } as any);
  const auth = await createProviderConnection({ provider: "antigravity", authType: "oauth", accessToken: "synthetic-auth", projectId: "auth-project", isActive: true, name: "Auth" } as any);

  const quotaResult = await markAccountUnavailable(quota.id, 429, "Resource has been exhausted (e.g. check quota).", "antigravity", "claude-opus-5-5-medium");
  const authResult = await markAccountUnavailable(auth.id, 401, "Invalid authentication credentials.", "antigravity", "claude-opus-5-5-medium");

  expect(quotaResult.reason).not.toBe("account_model_unsupported");
  expect(authResult.reason).not.toBe("account_model_unsupported");
});

test("Antigravity catalog availability includes an active AGY legacy account and selection dispatches exact Claude 4.6", async () => {
  const { createProviderConnection } = await import("../src/lib/db/providers.ts");
  const { getActiveSyncedCatalog } = await import("../src/lib/db/models/activeSyncedCatalog.ts");
  const newer = await createProviderConnection({ provider: "antigravity", authType: "oauth", accessToken: "synthetic-5-5", projectId: "new-project", isActive: true, name: "5.5 engine" } as any);
  const legacy = await createProviderConnection({ provider: "agy", authType: "oauth", accessToken: "synthetic-4-6", projectId: "legacy-project", isActive: true, name: "4.6 engine" } as any);
  await replaceSyncedAvailableModelsForConnection("antigravity", newer.id, [
    { id: "claude-opus-5-5-medium", name: "Claude Opus 5.5 (Medium)" },
  ]);
  await replaceSyncedAvailableModelsForConnection("agy", legacy.id, [
    { id: "claude-opus-4-6-thinking", name: "Claude Opus 4.6 (Thinking)" },
  ]);

  const catalog = await getActiveSyncedCatalog("antigravity");
  const selected = await getProviderCredentials("antigravity", newer.id, [newer.id, legacy.id], "claude-opus-4-6-thinking");

  expect(catalog.models.map((model) => model.id)).toContain("claude-opus-4-6-thinking");
  expect(selected?.connectionId).toBe(legacy.id);
  expect(selected?.accessToken).toBe("synthetic-4-6");
});

test("Claude 4.6 remains eligible on both known compatible Antigravity engines", () => {
  const olderCatalog = new Set(["claude-opus-4-6-thinking", "claude-sonnet-4-6"]);
  const newerCatalog = new Set([
    "claude-opus-4-6-thinking",
    "claude-sonnet-4-6",
    "claude-opus-5-5-medium",
    "gemini-4-argon-medium",
  ]);

  expect(isModelAdvertisedByConnection("claude-opus-4-6-thinking", olderCatalog, "antigravity")).toBe(true);
  expect(isModelAdvertisedByConnection("claude-opus-4-6-thinking", newerCatalog, "antigravity")).toBe(true);
  expect(isModelAdvertisedByConnection("claude-sonnet-4-6", olderCatalog, "antigravity")).toBe(true);
  expect(isModelAdvertisedByConnection("claude-sonnet-4-6", newerCatalog, "antigravity")).toBe(true);
});

test("unknown or empty Antigravity catalogs retain the existing fail-open selection semantics", async () => {
  const { createProviderConnection } = await import("../src/lib/db/providers.ts");
  const unknown = await createProviderConnection({ provider: "antigravity", authType: "oauth", accessToken: "synthetic-unknown", projectId: "unknown-project", isActive: true, name: "Unknown catalog" } as any);

  const selected = await getProviderCredentials("antigravity", null, [unknown.id], "gemini-4-argon-medium");

  expect(selected?.connectionId).toBe(unknown.id);
  expect(isModelAdvertisedByConnection("gemini-4-argon-medium", undefined, "antigravity")).toBe(true);
  expect(isModelAdvertisedByConnection("gemini-4-argon-medium", new Set(), "antigravity")).toBe(true);
});

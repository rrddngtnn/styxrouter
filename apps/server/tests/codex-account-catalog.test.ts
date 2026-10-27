import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// This file is run in its own process: never use the operator database.
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "styx-codex-catalog-"));
process.env.STYX_TEST_MODE = "1";
const { replaceSyncedAvailableModelsForConnection } = await import("../src/lib/db/models.ts");
const { loadAdvertisedModelsForSelfHostedConnections } = await import("../src/sse/services/auth.ts");
const { isModelAdvertisedByConnection } = await import("../src/domain/connectionModelRules.ts");

test("Codex effort aliases match canonical inventory and unknown inventories fail open", () => {
  const inventory = new Set(["gpt-6.1-terra"]);
  expect(isModelAdvertisedByConnection("codex/gpt-6.1-terra-high", inventory, "codex")).toBe(true);
  expect(isModelAdvertisedByConnection("cx/gpt-6.1-terra-xhigh", inventory, "codex")).toBe(true);
  expect(isModelAdvertisedByConnection("gpt-6.1-terra", undefined)).toBe(true);
  expect(isModelAdvertisedByConnection("gpt-6.1-terra", new Set())).toBe(true);
});

test("stale last-good Codex inventories remain restrictive until a successful refresh", async () => {
  const { updateProviderConnection, createProviderConnection } = await import("../src/lib/db/providers.ts");
  const { getProviderCredentials } = await import("../src/sse/services/auth.ts");
  const a = await createProviderConnection({ provider: "codex", authType: "oauth", accessToken: "test-a", isActive: true, name: "A" } as any);
  const b = await createProviderConnection({ provider: "codex", authType: "oauth", accessToken: "test-b", isActive: true, name: "B" } as any);
  await updateProviderConnection(a.id, { providerSpecificData: { modelCatalogSyncedAt: "2020-01-01T00:00:00Z" } });
  await replaceSyncedAvailableModelsForConnection("codex", a.id, [{ id: "gpt-6.1-sol", name: "Sol" }]);
  await replaceSyncedAvailableModelsForConnection("codex", b.id, [{ id: "gpt-6.1-terra", name: "Terra" }]);
  const selected = await getProviderCredentials("codex", null, [a.id, b.id], "gpt-6.1-terra-high");
  expect(selected?.connectionId).toBe(b.id);
});

test("Codex selection excludes accounts whose known catalog lacks the requested base model", async () => {
  await replaceSyncedAvailableModelsForConnection("codex", "account-a", [{ id: "gpt-6.1-sol", name: "Sol" }]);
  await replaceSyncedAvailableModelsForConnection("codex", "account-b", [{ id: "gpt-6.1-terra", name: "Terra" }]);
  const inventory = await loadAdvertisedModelsForSelfHostedConnections([
    { id: "account-a", provider: "codex" }, { id: "account-b", provider: "codex" },
  ] as any, "gpt-6.1-terra");
  expect(isModelAdvertisedByConnection("gpt-6.1-terra", inventory.get("account-a"))).toBe(false);
  expect(isModelAdvertisedByConnection("gpt-6.1-terra", inventory.get("account-b"))).toBe(true);
});

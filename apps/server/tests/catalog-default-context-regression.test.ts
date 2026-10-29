import { expect, test } from "bun:test";

const { enrichCatalogModelEntry } = await import("../src/lib/modelMetadataRegistry.ts");
const { createModelCapabilityResolutionSnapshot } = await import("../src/lib/modelCapabilityResolutionSnapshot.ts");
const { setModelContextOverride, removeModelContextOverride } = await import("../src/lib/db/modelContextOverrides.ts");
const { getResolvedModelCapabilities, resolveInputTokenCapForGate } = await import("../src/lib/modelCapabilities.ts");

test("catalog context is a router default for static, dynamic and specialty rows, without changing input gates", () => {
  setModelContextOverride("codex", "gpt-6.1-terra", 200_000, "auto:discovery");
  try {
    const snapshot = { modelsDevPricing: null, capabilityResolutionSnapshot: createModelCapabilityResolutionSnapshot() };
    const rows = [
      { id: "codex/gpt-6.1-terra-high", owned_by: "codex", context_length: 500_000 },
      { id: "openai/gpt-6.1-terra", owned_by: "openai", context_length: 256_000 },
      { id: "custom-provider/new-model", owned_by: "custom-provider", context_length: 32_000, max_input_tokens: 12_345, max_output_tokens: 999 },
      { id: "openai/text-embedding-3-small", owned_by: "openai", type: "embedding" },
    ];
    for (const row of rows) expect(enrichCatalogModelEntry(row, undefined, snapshot).context_length).toBe(1_000_000);
    const custom = enrichCatalogModelEntry(rows[2], undefined, snapshot);
    expect(custom.max_input_tokens).toBe(12_345);
    expect(custom.max_output_tokens).toBe(999);
    expect(getResolvedModelCapabilities({ provider: "codex", model: "gpt-6.1-terra" }).contextWindow).toBe(200_000);
    expect(resolveInputTokenCapForGate("codex/gpt-6.1-terra", { isCombo: true })).toBe(200_000);
  } finally { removeModelContextOverride("codex", "gpt-6.1-terra"); }
});

test("manual base and exact alias context values override the catalog default", () => {
  setModelContextOverride("codex", "gpt-6.1-terra", 350_000, "manual");
  setModelContextOverride("codex", "gpt-6.1-terra-ultra", 450_000, "manual");
  setModelContextOverride("custom-provider", "new-model", 42_000, "manual");
  try {
    const snapshot = { modelsDevPricing: null, capabilityResolutionSnapshot: createModelCapabilityResolutionSnapshot() };
    for (const snap of [undefined, snapshot]) {
      for (const [model, expected] of [["gpt-6.1-terra", 350_000], ["gpt-6.1-terra-high", 350_000], ["gpt-6.1-terra-ultra", 450_000]] as const) {
        expect(enrichCatalogModelEntry({ id: `cx/${model}`, owned_by: "cx" }, undefined, snap).context_length).toBe(expected);
      }
      expect(enrichCatalogModelEntry({ id: "custom-provider/new-model", owned_by: "custom-provider" }, undefined, snap).context_length).toBe(42_000);
    }
  } finally {
    removeModelContextOverride("codex", "gpt-6.1-terra");
    removeModelContextOverride("codex", "gpt-6.1-terra-ultra");
    removeModelContextOverride("custom-provider", "new-model");
  }
});

test("other Codex effort aliases inherit their manual base override", () => {
  setModelContextOverride("codex", "gpt-5.6-terra", 222_222, "manual");
  try {
    expect(enrichCatalogModelEntry({ id: "codex/gpt-5.6-terra-max", owned_by: "codex" }).context_length).toBe(222_222);
  } finally { removeModelContextOverride("codex", "gpt-5.6-terra"); }
});

test("no-thinking catalog aliases inherit a manual base override", () => {
  setModelContextOverride("claude", "claude-opus-4-6", 123_456, "manual");
  try {
    const entry = enrichCatalogModelEntry({ id: "no-think/claude/claude-opus-4-6", owned_by: "claude", root: "no-think/claude-opus-4-6" });
    expect(entry.context_length).toBe(123_456);
  } finally { removeModelContextOverride("claude", "claude-opus-4-6"); }
});

test("isolated actual catalog shows 1M for multiple providers and a custom model while retaining explicit token metadata", async () => {
  const { createProviderConnection } = await import("../src/lib/db/providers.ts");
  const { addCustomModel, replaceSyncedAvailableModelsForConnection } = await import("../src/lib/db/models.ts");
  const { getUnifiedModelsResponse } = await import("../src/app/api/v1/models/catalog.ts");
  const openai = await createProviderConnection({ provider: "openai", authType: "apikey", apiKey: "fixture", isActive: true, name: "openai fixture" } as any);
  await createProviderConnection({ provider: "codex", authType: "oauth", accessToken: "fixture", isActive: true, name: "codex fixture" } as any);
  await addCustomModel("openai", "manual-fixture-model", "Custom", "manual", "chat-completions", ["chat"], undefined, { inputTokenLimit: 12345, outputTokenLimit: 999 });
  await addCustomModel("openai", "dynamic-fixture-model", "Overlay", "manual", "chat-completions", ["chat"], undefined, { inputTokenLimit: 54321 });
  await replaceSyncedAvailableModelsForConnection("openai", openai.id, [{ id: "dynamic-fixture-model", name: "Dynamic", inputTokenLimit: 23000 }, { id: "discovery-only-model", name: "Discovered", inputTokenLimit: 32000 }]);
  const response = await getUnifiedModelsResponse(new Request("http://localhost/v1/models"));
  expect(response.status).toBe(200);
  const body: any = await response.json();
  const ordinary = body.data.filter((row: any) => row.owned_by !== "combo");
  expect(ordinary.length).toBeGreaterThan(10);
  expect(ordinary.filter((row: any) => row.context_length !== 1_000_000).map((row: any) => row.id).sort()).toEqual(["openai/dynamic-fixture-model", "openai/manual-fixture-model"]);
  for (const text of ["codex/", "openai/", "manual-fixture-model", "dynamic-fixture-model", "discovery-only-model"]) {
    expect(ordinary.some((row: any) => row.id.includes(text))).toBe(true);
  }
  const custom = ordinary.find((row: any) => row.id.endsWith("/manual-fixture-model"));
  expect(ordinary.find((row: any) => row.id.endsWith("/dynamic-fixture-model")).context_length).toBe(54321);
  expect(ordinary.find((row: any) => row.id.endsWith("/discovery-only-model")).context_length).toBe(1_000_000);
  expect(custom.context_length).toBe(12345);
  expect(custom.max_output_tokens).toBe(999);
});

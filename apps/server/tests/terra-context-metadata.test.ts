import { expect, test } from "bun:test";

const { getResolvedModelCapabilities, resolveInputTokenCapForGate } = await import("../src/lib/modelCapabilities.ts");
const { setModelContextOverride, removeModelContextOverride } = await import("../src/lib/db/modelContextOverrides.ts");
const { replaceSyncedAvailableModelsForConnection } = await import("../src/lib/db/models.ts");
const { createModelCapabilityResolutionSnapshot } = await import("../src/lib/modelCapabilityResolutionSnapshot.ts");
const { setModelCapabilityOverride, removeModelCapabilityOverride } = await import("../src/lib/db/modelCapabilityOverrides.ts");

test("Codex Terra default context is the operator default 1M for every model/provider", () => {
  for (const suffix of ["", "-none", "-low", "-medium", "-high", "-xhigh", "-max", "-ultra"]) {
    expect(getResolvedModelCapabilities({ provider: "codex", model: `gpt-6.1-terra${suffix}` }).contextWindow).toBe(1_000_000);
  }
  expect(getResolvedModelCapabilities({ provider: "openai", model: "gpt-6.1-terra" }).contextWindow).toBe(1_000_000);
});

test("fresh or stale auto-discovery is preserved for base and all effort aliases", async () => {
  setModelContextOverride("codex", "gpt-6.1-terra", 200_000, "auto:discovery");
  try {
    const snapshot = createModelCapabilityResolutionSnapshot();
    for (const suffix of ["", "-none", "-low", "-medium", "-high", "-xhigh", "-max", "-ultra"]) {
      const model = `gpt-6.1-terra${suffix}`;
      expect(getResolvedModelCapabilities({ provider: "codex", model }).contextWindow).toBe(200_000);
      expect(getResolvedModelCapabilities({ provider: "codex", model }, undefined, snapshot).contextWindow).toBe(200_000);
    }
  } finally { removeModelContextOverride("codex", "gpt-6.1-terra"); }
});

test("actual catalog advertises the router default after per-account discovery for every Terra alias", async () => {
  const { createProviderConnection } = await import("../src/lib/db/providers.ts");
  const { runContextWindowReconcile } = await import("../src/lib/contextWindowResolver.ts");
  const { getUnifiedModelsResponse } = await import("../src/app/api/v1/models/catalog.ts");
  const conn = await createProviderConnection({ provider: "codex", authType: "oauth", accessToken: "test", isActive: true, name: "test" } as any);
  await replaceSyncedAvailableModelsForConnection("codex", conn.id, [{ id: "gpt-6.1-terra", name: "Terra", inputTokenLimit: 500_000 }]);
  await runContextWindowReconcile();
  const response = await getUnifiedModelsResponse(new Request("http://localhost/v1/models"));
  expect(response.status).toBe(200);
  const body: any = await response.json();
  const terra = body.data.filter((row: any) => /^(?:codex|cx)\/gpt-6\.1-terra(?:-(?:none|low|medium|high|xhigh|max|ultra))?$/.test(row.id));
  const expectedIds = ["", "-none", "-low", "-medium", "-high", "-xhigh", "-max", "-ultra"].map((suffix) => `codex/gpt-6.1-terra${suffix}`);
  expect(terra.map((row: any) => row.id).sort()).toEqual(expectedIds.sort());
  for (const row of terra) {
    expect(row.context_length).toBe(1_000_000);
    expect(row.max_input_tokens).toBeUndefined();
  }
  setModelCapabilityOverride("codex/gpt-6.1-terra-high", "max_input_tokens", 750_000);
  try {
    const { enrichCatalogModelEntry } = await import("../src/lib/modelMetadataRegistry.ts");
    const entry = enrichCatalogModelEntry({ id: "codex/gpt-6.1-terra-high", owned_by: "codex" });
    expect(entry.max_input_tokens).toBe(750_000);
  } finally {
    removeModelCapabilityOverride("codex/gpt-6.1-terra-high", "max_input_tokens");
    removeModelContextOverride("codex", "gpt-6.1-terra");
  }
});

test("Terra client context does not invent an inference input limit; exact input overrides remain independent", () => {
  setModelContextOverride("codex", "gpt-6.1-terra", 200_000, "auto:discovery");
  setModelCapabilityOverride("codex/gpt-6.1-terra-high", "max_input_tokens", 750_000);
  try {
    const snapshot = createModelCapabilityResolutionSnapshot();
    for (const candidateSnapshot of [undefined, snapshot]) {
      const base = getResolvedModelCapabilities({ provider: "codex", model: "gpt-6.1-terra" }, undefined, candidateSnapshot);
      expect(base.contextWindow).toBe(200_000);
      expect(base.maxInputTokens).toBeNull();
      const high = getResolvedModelCapabilities({ provider: "codex", model: "gpt-6.1-terra-high" }, undefined, candidateSnapshot);
      expect(high.contextWindow).toBe(200_000);
      expect(high.maxInputTokens).toBe(750_000);
    }
    expect(resolveInputTokenCapForGate("codex/gpt-6.1-terra", { isCombo: true })).toBe(200_000);
    expect(resolveInputTokenCapForGate("codex/gpt-6.1-terra-high", { isCombo: true })).toBe(750_000);
  } finally {
    removeModelContextOverride("codex", "gpt-6.1-terra");
    removeModelCapabilityOverride("codex/gpt-6.1-terra-high", "max_input_tokens");
  }
});

test("manual base and alias overrides take precedence over auto-discovery", () => {
  setModelContextOverride("codex", "gpt-6.1-terra", 350_000, "manual");
  setModelContextOverride("codex", "gpt-6.1-terra-ultra", 450_000, "manual");
  try {
    const snapshot = createModelCapabilityResolutionSnapshot();
    for (const [model, value] of [["gpt-6.1-terra", 350_000], ["gpt-6.1-terra-high", 350_000], ["gpt-6.1-terra-ultra", 450_000]] as const) {
      expect(getResolvedModelCapabilities({ provider: "codex", model }, undefined, snapshot).contextWindow).toBe(value);
      expect(getResolvedModelCapabilities({ provider: "codex", model }).contextWindow).toBe(value);
    }
  } finally {
    removeModelContextOverride("codex", "gpt-6.1-terra");
    removeModelContextOverride("codex", "gpt-6.1-terra-ultra");
  }
});

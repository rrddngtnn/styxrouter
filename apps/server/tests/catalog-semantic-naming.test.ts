import { expect, test } from "bun:test";

import { normalizeCatalogDisplayName } from "../src/lib/catalogDisplayName.ts";
import { createProviderConnection } from "../src/lib/db/providers.ts";
import { createCombo } from "../src/lib/db/combos.ts";
import { replaceSyncedAvailableModelsForConnection } from "../src/lib/db/models.ts";
import { invalidateDbCache } from "../src/lib/db/readCache.ts";
import { getUnifiedModelsResponse } from "../src/app/api/v1/models/catalog.ts";
import { resolveExactEffortRoute } from "../open-sse/services/antigravityEffortFamily.ts";
import { buildScopedInventoryRows, expandAdminInventories } from "../server/providerModels.ts";

async function fetchCatalog(query: string): Promise<Array<Record<string, any>>> {
  const response = await getUnifiedModelsResponse(
    new Request(`http://localhost/v1/models${query}`)
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as { data: Array<Record<string, any>> };
  return body.data;
}

test("normalizeCatalogDisplayName enforces `<Base> (<Provider>)`, `<Base> <Tier> (<Provider>)`, dates, and technical tokens", () => {
  // Brand / version / acronym normalization with (<Provider>)
  expect(normalizeCatalogDisplayName("GPT 5.5", { modelId: "gpt-5.5", provider: "codex" })).toBe("GPT-5.5 (Codex)");
  expect(normalizeCatalogDisplayName("GPT-6.1 Terra", { modelId: "gpt-6.1-terra", provider: "codex" })).toBe("GPT-6.1 Terra (Codex)");
  expect(normalizeCatalogDisplayName(null, { modelId: "gpt-6.1-terra", provider: "codex" })).toBe("GPT-6.1 Terra (Codex)");
  expect(normalizeCatalogDisplayName("codex-auto-review", { modelId: "codex-auto-review", provider: "codex" })).toBe("Codex Auto Review (Codex)");
  expect(normalizeCatalogDisplayName("gpt-reserve", { modelId: "gpt-reserve", provider: "codex" })).toBe("GPT Reserve (Codex)");
  expect(normalizeCatalogDisplayName("GLM 5.3 Flash (Vision)", { modelId: "glm-5.3-flash", provider: "glm" })).toBe("GLM-5.3 Flash (GLM)");
  expect(normalizeCatalogDisplayName("GLM-5.3-FlashX", { modelId: "glm-5.3-flashx", provider: "codebuddy-cn" })).toBe("GLM-5.3 FlashX (CodeBuddy CN)");
  expect(normalizeCatalogDisplayName("GLM-5v-Turbo", { modelId: "glm-5v-turbo", provider: "codebuddy-cn" })).toBe("GLM-5V Turbo (CodeBuddy CN)");
  expect(normalizeCatalogDisplayName("GLM 4.6V (Vision)", { modelId: "glm-4.6v", provider: "glm" })).toBe("GLM-4.6V (GLM)");
  expect(normalizeCatalogDisplayName("Hy4 Preview", { modelId: "hy4-preview", provider: "codebuddy-cn" })).toBe("HY4 Preview (CodeBuddy CN)");
  expect(normalizeCatalogDisplayName("Hy3", { modelId: "hy3", provider: "codebuddy-cn" })).toBe("HY3 (CodeBuddy CN)");
  expect(normalizeCatalogDisplayName("hy4flash", { modelId: "hy4flash", provider: "codebuddy-cn" })).toBe("HY4 Flash (CodeBuddy CN)");
  expect(normalizeCatalogDisplayName("MiniMax-M3", { modelId: "minimax-m3", provider: "codebuddy-cn" })).toBe("MiniMax M3 (CodeBuddy CN)");
  expect(normalizeCatalogDisplayName("Kimi-K3.1-Pro", { modelId: "kimi-k3.1-pro", provider: "codebuddy-cn" })).toBe("Kimi K3.1 Pro (CodeBuddy CN)");
  expect(normalizeCatalogDisplayName("DeepSeek-V4.1-Flash", { modelId: "deepseek-v4.1-flash", provider: "codebuddy-cn" })).toBe("DeepSeek V4.1 Flash (CodeBuddy CN)");
  expect(normalizeCatalogDisplayName("DeepSeek-V3.2 (Volc)", { modelId: "deepseek-v3-2-volc", provider: "codebuddy-cn" })).toBe("DeepSeek V3.2 Volc (CodeBuddy CN)");
  expect(normalizeCatalogDisplayName("MiMo-V2.6-Pro", { modelId: "mimo-v2.6-pro", provider: "codebuddy-cn" })).toBe("MiMo V2.6 Pro (CodeBuddy CN)");
  expect(normalizeCatalogDisplayName("Space-Bunny", { modelId: "space-bunny", provider: "codebuddy-cn" })).toBe("Space Bunny (CodeBuddy CN)");
  expect(normalizeCatalogDisplayName("claude-sonnet-5-5", { modelId: "claude-sonnet-5-5", provider: "antigravity" })).toBe("Claude Sonnet 5.5 (Antigravity)");
  expect(normalizeCatalogDisplayName("Claude Sonnet 4.6 (Thinking)", { modelId: "claude-sonnet-4-6", provider: "antigravity" })).toBe("Claude Sonnet 4.6 (Antigravity)");
  expect(normalizeCatalogDisplayName("Claude Opus 4.6 (Thinking)", { modelId: "claude-opus-4-6-thinking", provider: "antigravity" })).toBe("Claude Opus 4.6 Thinking (Antigravity)");
  expect(normalizeCatalogDisplayName("Gemini 3.8 Flash (Tiered)", { modelId: "gemini-3.8-flash-tiered", provider: "antigravity" })).toBe("Gemini 3.8 Flash Tiered (Antigravity)");

  // ISO dates, MoE sizes, context tokens, and technical acronyms stay intact
  expect(normalizeCatalogDisplayName(null, { modelId: "gpt-4o-2024-08-06", provider: "openai" })).toBe("GPT-4o 2024-08-06 (OpenAI)");
  expect(normalizeCatalogDisplayName(null, { modelId: "mixtral-8x7b-fp8-moe", provider: "groq" })).toBe("Mixtral 8x7B FP8 MoE (Groq)");
  expect(normalizeCatalogDisplayName(null, { modelId: "qwen3-a3b-vlm-128k-swe", provider: "openrouter" })).toBe("Qwen3 A3B VLM 128K SWE (OpenRouter)");

  // Upstream label cleanup (redundant provider prefix + credit multipliers)
  expect(
    normalizeCatalogDisplayName("Kiro Claude Opus 5.5 (2.0x credit)", {
      modelId: "claude-opus-5.5",
      provider: "kiro",
    })
  ).toBe("Claude Opus 5.5 (Kiro)");
  expect(
    normalizeCatalogDisplayName("Kiro Deepseek v3.2 (0.3x credit)", {
      modelId: "deepseek-3.2",
      provider: "kiro",
    })
  ).toBe("DeepSeek V3.2 (Kiro)");
  expect(
    normalizeCatalogDisplayName("Kiro Auto", {
      modelId: "auto",
      provider: "kiro",
    })
  ).toBe("Auto (Kiro)");

  // Expanded fixed-effort variants: tier after model name WITHOUT parens; only provider in parens
  expect(
    normalizeCatalogDisplayName("GPT 5.6 Sol (xHigh)", {
      modelId: "gpt-5.6-sol-xhigh",
      provider: "codex",
      fixedEffort: "xhigh",
      appendEffortLabel: true,
    })
  ).toBe("GPT-5.6 Sol XHigh (Codex)");
  expect(
    normalizeCatalogDisplayName("GLM 5.3 High", {
      modelId: "glm-5.3-high",
      provider: "glm",
      fixedEffort: "high",
      appendEffortLabel: true,
    })
  ).toBe("GLM-5.3 High (GLM)");
  expect(
    normalizeCatalogDisplayName("Qwen3.7 Max", {
      modelId: "qwen3.7-max",
      provider: "opencode-go",
    })
  ).toBe("Qwen3.7 Max (OpenCode Go)");
  expect(
    normalizeCatalogDisplayName("qwen3.7-max-high", {
      modelId: "qwen3.7-max-high",
      provider: "opencode-go",
      fixedEffort: "high",
      appendEffortLabel: true,
    })
  ).toBe("Qwen3.7 Max High (OpenCode Go)");
  expect(
    normalizeCatalogDisplayName("Claude Sonnet 4.6 (no thinking)", {
      modelId: "no-think/claude-sonnet-4-6",
      provider: "claude",
      fixedEffort: "none",
      appendEffortLabel: true,
    })
  ).toBe("Claude Sonnet 4.6 None (Claude)");

  // Combos never return undefined and have no upstream provider parens
  expect(normalizeCatalogDisplayName(undefined, { modelId: "Muse", isCombo: true })).toBe("Muse");
  expect(normalizeCatalogDisplayName(undefined, { modelId: "auto/coding", isCombo: true })).toBe("Auto Coding");
});

test("/v1/models compact & expanded enforce `<Base> (<Provider>)` / `<Base> <Tier> (<Provider>)` and clean compact edge cases", async () => {
  await createCombo({
    name: "Muse",
    strategy: "priority",
    models: ["codex/gpt-5.5"],
    isActive: true,
  } as any);

  const codexConn: any = await createProviderConnection({
    provider: "codex",
    name: "naming-codex",
    authType: "oauth",
    accessToken: "codex-naming-token",
    isActive: true,
  } as any);
  await replaceSyncedAvailableModelsForConnection("codex", codexConn.id, [
    {
      id: "gpt-6.1-terra",
      name: "GPT-6.1 Terra",
      supportsThinking: true,
      supportedThinkingEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
    },
    {
      id: "codex-auto-review",
      name: "Codex Auto Review",
      supportsThinking: true,
      supportedThinkingEfforts: ["low", "medium", "high", "xhigh"],
    },
  ]);

  const agyConn: any = await createProviderConnection({
    provider: "antigravity",
    name: "naming-agy",
    authType: "oauth",
    accessToken: "agy-naming-token",
    isActive: true,
  } as any);
  await replaceSyncedAvailableModelsForConnection("antigravity", agyConn.id, [
    {
      id: "gemini-3.8-flash-low",
      name: "Gemini 3.8 Flash (Low)",
      supportsThinking: true,
      effortVariant: { baseModel: "gemini-3.8-flash", effort: "low" },
    },
    {
      id: "gemini-3.8-flash-medium",
      name: "Gemini 3.8 Flash (Medium)",
      supportsThinking: true,
      effortVariant: { baseModel: "gemini-3.8-flash", effort: "medium" },
    },
    {
      id: "gemini-3.8-flash-high",
      name: "Gemini 3.8 Flash (High)",
      supportsThinking: true,
      effortVariant: { baseModel: "gemini-3.8-flash", effort: "high" },
    },
    {
      id: "gemini-3.8-flash-tiered",
      name: "gemini-3.8-flash-tiered",
      supportsVision: true,
    },
    {
      id: "agy-dyn-low",
      name: "AGY Dynamic (Low)",
      supportsThinking: true,
      effortVariant: { baseModel: "agy-dyn", effort: "low" },
    },
    {
      id: "agy-dyn-high",
      name: "AGY Dynamic (High)",
      supportsThinking: true,
      effortVariant: { baseModel: "agy-dyn", effort: "high" },
    },
    {
      id: "agy-dyn-xhigh",
      name: "AGY Dynamic (XHigh)",
      supportsThinking: true,
      effortVariant: { baseModel: "agy-dyn", effort: "xhigh" },
    },
    {
      id: "agy-dyn-tiered-high",
      name: "AGY Dynamic (High)",
      supportsThinking: true,
      effortVariant: { baseModel: "agy-dyn-tiered", effort: "high" },
    },
    {
      id: "agy-dyn-tiered-xhigh",
      name: "AGY Dynamic (XHigh)",
      supportsThinking: true,
      effortVariant: { baseModel: "agy-dyn-tiered", effort: "xhigh" },
    },
    {
      id: "gemini-pro-agent",
      name: "Gemini 3.1 Pro (High)",
    },
    {
      id: "gemini-3.1-pro-low",
      name: "Gemini 3.1 Pro (Low)",
    },
    {
      id: "gpt-oss-120b-medium",
      name: "GPT-OSS 120B (Medium)",
    },
  ]);

  const kiroConn: any = await createProviderConnection({
    provider: "kiro",
    name: "naming-kiro",
    authType: "oauth",
    accessToken: "kiro-naming-token",
    isActive: true,
  } as any);
  await replaceSyncedAvailableModelsForConnection("kiro", kiroConn.id, [
    { id: "auto", name: "Kiro Auto" },
    { id: "claude-opus-5.5", name: "Kiro Claude Opus 5.5 (2.0x credit)" },
    { id: "gpt-5.6-sol", name: "Kiro GPT 5.6 Sol (4.4x credit)" },
  ]);

  const glmConn: any = await createProviderConnection({
    provider: "glm",
    name: "naming-glm",
    authType: "apikey",
    apiKey: "glm-naming-key",
    isActive: true,
  } as any);
  expect(glmConn.id).toBeTruthy();

  invalidateDbCache("models");
  const compact = await fetchCatalog("?prefix=canonical&effort=compact");
  const expanded = await fetchCatalog("?prefix=canonical");
  const byId = (rows: Array<Record<string, any>>, id: string) => rows.find((r) => r.id === id);

  // 1. Every entry in BOTH compact and expanded has a unique semantic name; provider-backed
  //    models have parentheses ONLY for `(<Provider>)` at the end.
  for (const listing of [compact, expanded]) {
    const seenNames = new Map<string, string>();
    for (const row of listing) {
      expect(typeof row.name).toBe("string");
      expect(row.name.trim().length).toBeGreaterThan(0);
      if (row.owned_by !== "combo") {
        expect(row.name).toMatch(/^[^()]+\([^()]+\)$/);
        if (typeof row.root === "string" && row.root.includes("-")) {
          expect(row.name).not.toBe(row.root);
        }
      }
      expect(seenNames.get(row.name)).toBeUndefined();
      seenNames.set(row.name, row.id);
    }
  }
  expect(byId(expanded, "antigravity/gemini-3.1-pro-high")).toBeUndefined();
  expect(byId(expanded, "antigravity/agy-dyn-tiered")?.name).toBe("AGY Dynamic Tiered (Antigravity)");
  expect(byId(expanded, "antigravity/agy-dyn-tiered-high")?.name).toBe("AGY Dynamic Tiered High (Antigravity)");

  // Combo has non-undefined name without provider parens
  expect(byId(compact, "Muse")?.name).toBe("Muse");

  // 2. Codex gpt-6.1-terra-none is collapsed in compact & marked fixed_effort: "none" in expanded
  expect(byId(compact, "codex/gpt-6.1-terra")?.name).toBe("GPT-6.1 Terra (Codex)");
  expect(byId(compact, "codex/gpt-6.1-terra-none")).toBeUndefined();
  const terraNoneExp = byId(expanded, "codex/gpt-6.1-terra-none");
  expect(terraNoneExp?.name).toBe("GPT-6.1 Terra None (Codex)");
  expect(terraNoneExp?.capabilities?.fixed_effort).toBe("none");
  expect(terraNoneExp?.capabilities?.reasoning).toBe(false);
  expect(terraNoneExp?.capabilities?.effort_configurable).toBe(false);

  // 3. Antigravity compact edge cases
  expect(byId(compact, "antigravity/gemini-3.8-flash")?.name).toBe("Gemini 3.8 Flash (Antigravity)");
  expect(byId(compact, "antigravity/gemini-3.8-flash-tiered")).toBeUndefined();
  const flashTieredExp = byId(expanded, "antigravity/gemini-3.8-flash-tiered");
  expect(flashTieredExp?.name).toBe("Gemini 3.8 Flash Tiered (Antigravity)");
  expect(flashTieredExp?.capabilities?.effort_configurable).toBe(false);
  expect(flashTieredExp?.capabilities?.effort_tiers).toBeUndefined();

  // Subsumed -tiered family disappears in compact, base family keeps clean semantic name
  expect(byId(compact, "antigravity/agy-dyn")?.name).toBe("AGY Dynamic (Antigravity)");
  expect(byId(compact, "antigravity/agy-dyn-tiered")).toBeUndefined();
  expect(byId(compact, "antigravity/agy-dyn-tiered-high")).toBeUndefined();

  // Gemini 3.1 Pro family unifies gemini-pro-agent + gemini-3.1-pro-low in compact & routes cleanly
  const pro31Cmp = byId(compact, "antigravity/gemini-3.1-pro");
  expect(pro31Cmp?.name).toBe("Gemini 3.1 Pro (Antigravity)");
  expect(pro31Cmp?.capabilities?.effort_tiers).toEqual(["low", "high"]);
  expect(pro31Cmp?.default_reasoning_effort).toBe("high");
  expect(byId(compact, "antigravity/gemini-pro-agent")).toBeUndefined();
  expect(byId(compact, "antigravity/gemini-3.1-pro-low")).toBeUndefined();
  expect(byId(expanded, "antigravity/gemini-pro-agent")?.name).toBe("Gemini 3.1 Pro High (Antigravity)");
  expect(byId(expanded, "antigravity/gemini-3.1-pro-low")?.name).toBe("Gemini 3.1 Pro Low (Antigravity)");
  expect((await resolveExactEffortRoute("antigravity", "gemini-3.1-pro", {}))?.wireId).toBe("gemini-pro-agent");
  expect(
    (await resolveExactEffortRoute("antigravity", "gemini-3.1-pro", { reasoning_effort: "low" }))?.wireId
  ).toBe("gemini-3.1-pro-low");

  // Single-tier static alias gpt-oss-120b collapses gpt-oss-120b-medium in compact without fake effort_tiers
  const gptOssCmp = byId(compact, "antigravity/gpt-oss-120b");
  expect(gptOssCmp?.name).toBe("GPT-OSS 120B (Antigravity)");
  expect(gptOssCmp?.capabilities?.effort_configurable).toBe(false);
  expect(gptOssCmp?.capabilities?.fixed_effort).toBe("medium");
  expect(gptOssCmp?.capabilities?.effort_tiers).toBeUndefined();
  expect(byId(compact, "antigravity/gpt-oss-120b-medium")).toBeUndefined();
  expect(byId(expanded, "antigravity/gpt-oss-120b-medium")?.name).toBe("GPT-OSS 120B Medium (Antigravity)");

  // 4. Upstream label cleanup & natural provider disambiguation via (<Provider>)
  expect(byId(compact, "kiro/auto")?.name).toBe("Auto (Kiro)");
  expect(byId(compact, "kiro/claude-opus-5.5")?.name).toBe("Claude Opus 5.5 (Kiro)");
  expect(byId(compact, "antigravity/claude-opus-5-5")?.name).toBe("Claude Opus 5.5 (Antigravity)");
  expect(byId(expanded, "kiro/claude-opus-5.5-low")?.name).toBe("Claude Opus 5.5 Low (Kiro)");
  expect(byId(compact, "kiro/gpt-5.6-sol")?.name).toBe("GPT-5.6 Sol (Kiro)");
  expect(byId(compact, "codex/gpt-5.6-sol")?.name).toBe("GPT-5.6 Sol (Codex)");
  expect(byId(compact, "glm/glm-5.3-flash")?.name).toBe("GLM-5.3 Flash (GLM)");
  expect(byId(expanded, "glm/glm-5.3-high")?.name).toBe("GLM-5.3 High (GLM)");

  // 5. Admin provider catalog matches the same semantic naming contract
  const adminInventories: any[] = [
    {
      providerId: "kiro",
      nodeId: null,
      prefix: "kiro",
      models: [{ id: "claude-opus-5.5", name: "Kiro Claude Opus 5.5 (2.0x credit)", origin: "synced" }],
    },
    {
      providerId: "glm",
      nodeId: null,
      prefix: "glm",
      models: [
        { id: "glm-5.3", name: "GLM 5.3", origin: "built-in", supportedThinkingEfforts: ["low", "high", "max"] },
        { id: "glm-5.3-high", name: "GLM 5.3 High", origin: "built-in" },
      ],
    },
  ];
  expandAdminInventories(adminInventories, {}, new Map());
  const adminRows = buildScopedInventoryRows(adminInventories);
  expect(adminRows.find((r) => r.id === "kiro/claude-opus-5.5")?.name).toBe("Claude Opus 5.5 (Kiro)");
  expect(adminRows.find((r) => r.id === "kiro/claude-opus-5.5-low")?.name).toBe("Claude Opus 5.5 Low (Kiro)");
  expect(adminRows.find((r) => r.id === "glm/glm-5.3")?.name).toBe("GLM-5.3 (GLM)");
  expect(adminRows.find((r) => r.id === "glm/glm-5.3-high")?.name).toBe("GLM-5.3 High (GLM)");
});

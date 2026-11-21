import { expect, test } from "bun:test";
import { createProviderConnection, createProviderNode } from "../src/lib/db/providers.ts";
import { replaceSyncedAvailableModelsForConnection } from "../src/lib/db/models.ts";
import {
  getUnifiedModelsResponse,
  __resetCatalogBuilderRunsForTest,
  __getCatalogBuilderRunsForTest,
} from "../src/app/api/v1/models/catalog.ts";
import { getModelInfo } from "../src/sse/services/model.ts";
import { CodexExecutor } from "../open-sse/executors/codex.ts";
import { splitCodexReasoningSuffix } from "../open-sse/executors/codex/reasoningSuffix.ts";
import { parseGlmEffortTier } from "../open-sse/executors/glm.ts";
import { parseEffortLevel as parseOpencodeEffortLevel } from "../open-sse/executors/opencode.ts";
import { applyClaudeEffortVariant } from "../open-sse/handlers/chatCore/claudeEffortVariant.ts";
import { applyNoThinkingAlias } from "../open-sse/utils/noThinkingAlias.ts";
import {
  readAntigravityEffortVariants,
  resolveExactEffortRoute,
} from "../open-sse/services/antigravityEffortFamily.ts";
import { resolveAntigravityModelId } from "../open-sse/config/antigravityModelAliases.ts";
import { collectEffortFamilies } from "../src/shared/reasoning/effortVariants.ts";
import { expandAdminInventories } from "../server/providerModels.ts";
import { invalidateDbCache } from "../src/lib/db/readCache.ts";
import { updateSettings } from "../src/lib/db/settings.ts";

type CatalogRow = {
  id: string;
  root?: string;
  owned_by?: string;
  type?: string;
  capabilities?: Record<string, unknown>;
};

async function fetchCatalog(query = ""): Promise<CatalogRow[]> {
  const url = `http://localhost/v1/models${query}`;
  const res = await getUnifiedModelsResponse(new Request(url));
  expect(res.status).toBe(200);
  const body = (await res.json()) as { data: CatalogRow[] };
  return body.data;
}

function byId(rows: CatalogRow[], id: string): CatalogRow | undefined {
  return rows.find((row) => row.id === id);
}

test("cross-provider effort contract: identical base tiers across compact/expanded, cache order, fixed aliases, routing, literal collisions, and unknown metadata", async () => {
  await updateSettings({ hideNoThinkVariants: false });
  // 1. Seed a custom OpenAI-compatible provider with:
  //    - thinker: known effort tiers ["low", "medium", "high"]
  //    - collide + collide-high: literal ID collision test
  //    - unknown-model: unknown metadata (no thinking/effort info)
  const customNode: any = await createProviderNode({
    type: "openai-compatible",
    name: "Contract Synced",
    prefix: "contractsync",
    apiType: "chat",
    baseUrl: "https://never.invalid/v1",
  });
  const customConn: any = await createProviderConnection({
    provider: customNode.id,
    name: "contract-sync-conn",
    authType: "apikey",
    apiKey: "sk-contract-sync",
    isActive: true,
  } as any);
  await replaceSyncedAvailableModelsForConnection(customNode.id, customConn.id, [
    {
      id: "vendor/thinker",
      name: "Thinker",
      supportsThinking: true,
      supportedThinkingEfforts: ["low", "medium", "high"],
    },
    {
      id: "vendor/collide",
      name: "Collide Base",
      supportsThinking: true,
      supportedThinkingEfforts: ["low", "high"],
    },
    {
      id: "vendor/collide-high",
      name: "Collide Literal High",
    },
    {
      id: "vendor/unknown-model",
      name: "Unknown Model",
    },
  ]);

  // 2. Seed Claude OAuth connection (for Claude base tiers, aliases, no-think, rejectsThinkingDisabled)
  await createProviderConnection({
    provider: "claude",
    name: "contract-claude",
    authType: "oauth",
    accessToken: "claude-contract-token",
    isActive: true,
  } as any);

  // 3. Seed GLM connection (static effort aliases glm-5.3-*, glm-5.2-*, and non-tier glm-5.1)
  await createProviderConnection({
    provider: "glm",
    name: "contract-glm",
    authType: "apikey",
    apiKey: "glm-contract-key",
    isActive: true,
  } as any);

  // 3b. Seed OpenCode Go connection (static aliases + registry synced-style deepseek-v4-*)
  await createProviderConnection({
    provider: "opencode-go",
    name: "contract-opencode-go",
    authType: "apikey",
    apiKey: "opencode-go-contract-key",
    isActive: true,
  } as any);

  // 3c. Seed Antigravity connection with declared effort family + unknown non-family model
  const agyConn: any = await createProviderConnection({
    provider: "antigravity",
    name: "contract-antigravity",
    authType: "oauth",
    accessToken: "agy-contract-token",
    projectId: "agy-contract-proj",
    isActive: true,
  } as any);
  await replaceSyncedAvailableModelsForConnection("antigravity", agyConn.id, [
    {
      id: "gemini-3.7-flash-low",
      name: "Gemini 3.7 Flash (Low)",
      supportsThinking: true,
      effortVariant: { baseModel: "gemini-3.7-flash", effort: "low" },
    },
    {
      id: "gemini-3.7-flash-medium",
      name: "Gemini 3.7 Flash (Medium)",
      supportsThinking: true,
      effortVariant: { baseModel: "gemini-3.7-flash", effort: "medium", default: true },
    },
    {
      id: "gemini-3.7-flash-high",
      name: "Gemini 3.7 Flash (High)",
      supportsThinking: true,
      effortVariant: { baseModel: "gemini-3.7-flash", effort: "high" },
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
      effortVariant: { baseModel: "agy-dyn", effort: "high", default: true },
    },
    {
      id: "agy-unknown-plain",
      name: "AGY Unknown Plain",
    },
  ]);

  // 4. Seed Codex connections:
  //    - baseConn: advertises gpt-5.6-sol, gpt-5.6-luna, gpt-6.1-terra, gpt-5.5, and a no-thinking model
  //    - exactConn: literally advertises gpt-5.5-high (collision test)
  const codexBase: any = await createProviderConnection({
    provider: "codex",
    name: "contract-codex-base",
    authType: "oauth",
    accessToken: "codex-base-token",
    isActive: true,
  } as any);
  const codexExact: any = await createProviderConnection({
    provider: "codex",
    name: "contract-codex-exact",
    authType: "oauth",
    accessToken: "codex-exact-token",
    isActive: true,
  } as any);
  await replaceSyncedAvailableModelsForConnection("codex", codexBase.id, [
    {
      id: "gpt-5.6-sol",
      name: "GPT 5.6 Sol",
      supportsThinking: true,
      supportedThinkingEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
    },
    {
      id: "gpt-5.6-luna",
      name: "GPT 5.6 Luna",
      supportsThinking: true,
      supportedThinkingEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"], // ultra must be clamped out by luna's cap
    },
    {
      id: "gpt-6.1-terra",
      name: "GPT 6.1 Terra",
      supportsThinking: true,
      supportedThinkingEfforts: ["none", "low", "medium", "high", "xhigh", "max", "ultra"],
    },
    {
      id: "gpt-5.5",
      name: "GPT 5.5",
      supportsThinking: true,
      supportedThinkingEfforts: ["low", "high"],
    },
    {
      id: "gpt-5-plain",
      name: "GPT 5 Plain",
      supportsThinking: false,
    },
  ]);
  await replaceSyncedAvailableModelsForConnection("codex", codexExact.id, [
    {
      id: "gpt-5.5-high",
      name: "GPT 5.5 Literal High",
    },
  ]);

  // --- Cache-order test 1: compact -> expanded ---
  invalidateDbCache("models");
  __resetCatalogBuilderRunsForTest();
  const compactFirst = await fetchCatalog("?prefix=canonical&effort=compact");
  const expandedAfterCompact = await fetchCatalog("?prefix=canonical");
  expect(__getCatalogBuilderRunsForTest()).toBe(2);

  // --- Cache-order test 2: expanded -> compact ---
  invalidateDbCache("models");
  __resetCatalogBuilderRunsForTest();
  const expandedFirst = await fetchCatalog("?prefix=canonical");
  const compactAfterExpanded = await fetchCatalog("?prefix=canonical&effort=compact");
  expect(__getCatalogBuilderRunsForTest()).toBe(2);

  // Cache order must not change listing results
  expect(compactFirst.map((r) => r.id)).toEqual(compactAfterExpanded.map((r) => r.id));
  expect(expandedFirst.map((r) => r.id)).toEqual(expandedAfterCompact.map((r) => r.id));

  const expanded = expandedFirst;
  const compact = compactFirst;

  // --- Invariant 1: Base IDs have IDENTICAL effort_tiers & effort_configurable in expanded and compact ---
  const baseExpectations: Array<{ id: string; tiers: string[] | undefined; configurable: boolean }> = [
    { id: "contractsync/vendor/thinker", tiers: ["low", "medium", "high"], configurable: true },
    { id: "claude/claude-opus-4-6", tiers: ["none", "low", "medium", "high"], configurable: true },
    { id: "claude/claude-fable-5", tiers: ["low", "medium", "high", "xhigh"], configurable: true },
    { id: "claude/claude-sonnet-5", tiers: ["none", "low", "medium", "high", "xhigh"], configurable: true },
    { id: "glm/glm-5.3", tiers: ["low", "high", "max"], configurable: true },
    { id: "glm/glm-5.2", tiers: ["high", "max"], configurable: true },
    { id: "glm/glm-5.1", tiers: undefined, configurable: false },
    { id: "opencode-go/glm-5.2", tiers: ["high", "max"], configurable: true },
    { id: "opencode-go/hy3", tiers: ["none", "low", "high"], configurable: true },
    { id: "opencode-go/grok-4.5", tiers: ["low", "medium", "high"], configurable: true },
    { id: "opencode-go/kimi-k3", tiers: ["max"], configurable: true },
    { id: "opencode-go/qwen3.7-max", tiers: ["high", "max"], configurable: true },
    { id: "opencode-go/deepseek-v4-pro", tiers: ["none", "low", "high", "max"], configurable: true },
    { id: "antigravity/gemini-3.7-flash", tiers: ["low", "medium", "high"], configurable: true },
    { id: "codex/gpt-5.6-sol", tiers: ["low", "medium", "high", "xhigh", "max", "ultra"], configurable: true },
    { id: "codex/gpt-5.6-luna", tiers: ["low", "medium", "high", "xhigh", "max"], configurable: true },
    {
      id: "codex/gpt-6.1-terra",
      tiers: ["none", "low", "medium", "high", "xhigh", "max", "ultra"],
      configurable: true,
    },
    { id: "codex/gpt-5.5", tiers: ["low", "high"], configurable: true },
    { id: "codex/gpt-5-plain", tiers: undefined, configurable: false },
  ];

  for (const expected of baseExpectations) {
    const expRow = byId(expanded, expected.id);
    const cmpRow = byId(compact, expected.id);
    expect(expRow).toBeDefined();
    expect(cmpRow).toBeDefined();
    expect(expRow?.capabilities?.effort_tiers).toEqual(expected.tiers);
    expect(cmpRow?.capabilities?.effort_tiers).toEqual(expected.tiers);
    expect(expRow?.capabilities?.effort_configurable).toBe(expected.configurable);
    expect(cmpRow?.capabilities?.effort_configurable).toBe(expected.configurable);
  }

  // --- Invariant 2: Fixed effort aliases never inherit effort_tiers and distinguish reasoning vs configurable ---
  const fixedReasoningAliases: Array<{ id: string; effort: string }> = [
    { id: "contractsync/vendor/thinker-high", effort: "high" },
    { id: "contractsync/vendor/thinker-low", effort: "low" },
    { id: "claude/claude-opus-4-6-high", effort: "high" },
    { id: "claude/claude-fable-5-xhigh", effort: "xhigh" },
    { id: "glm/glm-5.3-high", effort: "high" },
    { id: "glm/glm-5.2-max", effort: "max" },
    { id: "opencode-go/glm-5.2-high", effort: "high" },
    { id: "opencode-go/grok-4.5-high", effort: "high" },
    { id: "opencode-go/kimi-k3-max", effort: "max" },
    { id: "opencode-go/qwen3.7-max-high", effort: "high" },
    { id: "opencode-go/deepseek-v4-pro-high", effort: "high" },
    { id: "antigravity/gemini-3.7-flash-high", effort: "high" },
    { id: "antigravity/gemini-3.7-flash-low", effort: "low" },
    { id: "codex/gpt-5.6-sol-high", effort: "high" },
    { id: "codex/gpt-5.6-sol-ultra", effort: "ultra" },
    { id: "codex/gpt-5.5-low", effort: "low" },
  ];

  for (const { id, effort } of fixedReasoningAliases) {
    const expRow = byId(expanded, id);
    expect(expRow).toBeDefined();
    expect(expRow?.capabilities?.reasoning).toBe(true);
    expect(expRow?.capabilities?.thinking).toBe(true);
    expect(expRow?.capabilities?.supportsThinking).toBe(true);
    expect(expRow?.capabilities?.effort_configurable).toBe(false);
    expect(expRow?.capabilities?.fixed_effort).toBe(effort);
    expect(expRow?.capabilities?.effort_tiers).toBeUndefined();

    // Compact mode omits synthetic and verified static effort aliases
    expect(byId(compact, id)).toBeUndefined();
  }

  // Unsupported aliases must NOT be advertised
  expect(byId(expanded, "claude/claude-opus-4-6-xhigh")).toBeUndefined();
  expect(byId(expanded, "codex/gpt-5.6-luna-ultra")).toBeUndefined();
  expect(byId(expanded, "no-think/claude/claude-fable-5")).toBeUndefined();

  // no-think/ alias: thinking disabled, no effort_tiers, omitted in compact mode
  const noThinkRow = byId(expanded, "no-think/claude/claude-sonnet-4-6");
  expect(noThinkRow).toBeDefined();
  expect(noThinkRow?.capabilities?.reasoning).toBe(false);
  expect(noThinkRow?.capabilities?.thinking).toBe(false);
  expect(noThinkRow?.capabilities?.supportsThinking).toBe(false);
  expect(noThinkRow?.capabilities?.effort_configurable).toBe(false);
  expect(noThinkRow?.capabilities?.fixed_effort).toBe("none");
  expect(noThinkRow?.capabilities?.effort_tiers).toBeUndefined();
  expect(byId(compact, "no-think/claude/claude-sonnet-4-6")).toBeUndefined();

  // OpenCode -none fixed alias disables reasoning, omits effort_tiers, and is omitted in compact
  const hy3None = byId(expanded, "opencode-go/hy3-none");
  expect(hy3None).toBeDefined();
  expect(hy3None?.capabilities?.reasoning).toBe(false);
  expect(hy3None?.capabilities?.thinking).toBe(false);
  expect(hy3None?.capabilities?.supportsThinking).toBe(false);
  expect(hy3None?.capabilities?.effort_configurable).toBe(false);
  expect(hy3None?.capabilities?.fixed_effort).toBe("none");
  expect(hy3None?.capabilities?.effort_tiers).toBeUndefined();
  expect(byId(compact, "opencode-go/hy3-none")).toBeUndefined();

  // --- Invariant 3: Literal ID wins on collision (in catalog AND routing) ---
  // 3a. Synced custom provider literal collision
  const expCollideLiteral = expanded.filter((r) => r.id === "contractsync/vendor/collide-high");
  expect(expCollideLiteral).toHaveLength(1);
  expect(expCollideLiteral[0].capabilities?.fixed_effort).toBeUndefined();
  expect(byId(compact, "contractsync/vendor/collide-high")).toBeDefined();
  // Non-colliding sibling tier is still synthesized in expanded & omitted in compact
  expect(byId(expanded, "contractsync/vendor/collide-low")?.capabilities?.fixed_effort).toBe("low");
  expect(byId(compact, "contractsync/vendor/collide-low")).toBeUndefined();

  const literalRoute = await getModelInfo("contractsync/vendor/collide-high");
  expect(literalRoute.model).toBe("vendor/collide-high");
  expect(literalRoute.resolvedThinkingEffort).toBeUndefined();

  // 3b. Codex literal collision: gpt-5.5-high is literally synced, must survive compact and stay non-alias
  const cmpCodexLiteral = byId(compact, "codex/gpt-5.5-high");
  expect(cmpCodexLiteral).toBeDefined();
  const expCodexLiteral = byId(expanded, "codex/gpt-5.5-high");
  expect(expCodexLiteral).toBeDefined();
  expect(expCodexLiteral?.capabilities?.fixed_effort).toBeUndefined();

  // Unrelated -max model ID must not split
  expect(splitCodexReasoningSuffix("gpt-6.1-sol-max")).toEqual({
    baseModel: "gpt-6.1-sol-max",
    effort: null,
  });

  // --- Invariant 4: Unknown metadata produces NO aliases and no effort_tiers ---
  const unknownExp = byId(expanded, "contractsync/vendor/unknown-model");
  const unknownCmp = byId(compact, "contractsync/vendor/unknown-model");
  expect(unknownExp).toBeDefined();
  expect(unknownCmp).toBeDefined();
  expect(unknownExp?.capabilities?.effort_tiers).toBeUndefined();
  expect(unknownCmp?.capabilities?.effort_tiers).toBeUndefined();
  expect(
    expanded.some(
      (r) =>
        r.id.startsWith("contractsync/vendor/unknown-model-") ||
        r.id === "no-think/contractsync/vendor/unknown-model"
    )
  ).toBe(false);

  // --- Invariant 5: Every advertised alias resolves to the exact base model & upstream value ---
  // 5a. Synced effort alias routing
  const syncedRoute = await getModelInfo("contractsync/vendor/thinker-high");
  expect(syncedRoute.model).toBe("vendor/thinker");
  expect(syncedRoute.resolvedThinkingEffort).toBe("high");

  // 5b. Claude effort alias routing
  const claudeBody: Record<string, unknown> = { model: "claude-opus-4-6-high" };
  const claudeApplied = applyClaudeEffortVariant({
    provider: "claude",
    effectiveModel: "claude-opus-4-6-high",
    body: claudeBody,
    sourceFormat: "openai",
  });
  expect(claudeApplied.effectiveModel).toBe("claude-opus-4-6");
  expect(claudeBody.model).toBe("claude-opus-4-6");
  expect(claudeBody.reasoning_effort).toBe("high");

  // 5c. no-think/ routing (Claude and OpenAI formats)
  const noThinkClaude: Record<string, unknown> = {
    model: "no-think/claude/claude-sonnet-4-6",
    reasoning_effort: "high",
  };
  expect(applyNoThinkingAlias(noThinkClaude, { claudeFormat: true })).toEqual({
    applied: true,
    realModel: "claude/claude-sonnet-4-6",
  });
  expect(noThinkClaude.model).toBe("claude/claude-sonnet-4-6");
  expect(noThinkClaude.thinking).toEqual({ type: "disabled" });
  expect(noThinkClaude.reasoning_effort).toBeUndefined();

  const noThinkOpenAI: Record<string, unknown> = {
    model: "no-think/claude/claude-sonnet-4-6",
    reasoning_effort: "high",
  };
  expect(applyNoThinkingAlias(noThinkOpenAI, { claudeFormat: false })).toEqual({
    applied: true,
    realModel: "claude/claude-sonnet-4-6",
  });
  expect(noThinkOpenAI.reasoning_effort).toBe("none");

  // 5d. Codex executor routing
  const codexExecutor = new CodexExecutor();
  for (const [alias, expectedBase, expectedWireEffort] of [
    ["gpt-5.6-sol-high", "gpt-5.6-sol", "high"],
    ["gpt-5.6-sol-ultra", "gpt-5.6-sol", "max"],
    ["gpt-6.1-terra-max", "gpt-6.1-terra", "max"],
    ["gpt-6.1-terra-none", "gpt-6.1-terra", "none"],
  ] as const) {
    const transformed = codexExecutor.transformRequest(
      alias,
      { model: alias, reasoning: { effort: "low" } },
      true,
      {} as any
    ) as any;
    expect(transformed.model).toBe(expectedBase);
    expect(transformed.reasoning?.effort).toBe(expectedWireEffort);
  }

  // 5e. GLM alias routing
  expect(parseGlmEffortTier("glm-5.3-low")).toEqual({
    baseModel: "glm-5.3",
    effort: "low",
    transport: "openai",
  });
  expect(parseGlmEffortTier("glm-5.3-high")).toEqual({
    baseModel: "glm-5.3",
    effort: "high",
    transport: "openai",
  });
  expect(parseGlmEffortTier("glm-5.3-max")).toEqual({
    baseModel: "glm-5.3",
    effort: "max",
    transport: "openai",
  });
  expect(parseGlmEffortTier("glm-5.2-high")).toEqual({
    baseModel: "glm-5.2",
    effort: "high",
    transport: "anthropic",
  });
  expect(parseGlmEffortTier("glm-5.2-max")).toEqual({
    baseModel: "glm-5.2",
    effort: "max",
    transport: "anthropic",
  });

  // 5f. OpenCode alias routing
  expect(parseOpencodeEffortLevel("glm-5.2-high")).toEqual({ baseModel: "glm-5.2", effort: "high" });
  expect(parseOpencodeEffortLevel("hy3-none")).toEqual({ baseModel: "hy3", effort: "none" });
  expect(parseOpencodeEffortLevel("grok-4.5-high")).toEqual({ baseModel: "grok-4.5", effort: "high" });
  expect(parseOpencodeEffortLevel("kimi-k3-max")).toEqual({ baseModel: "kimi-k3", effort: "max" });
  expect(parseOpencodeEffortLevel("qwen3.7-max-high")).toEqual({ baseModel: "qwen3.7-max", effort: "high" });

  // 5g. Antigravity exact effort family routing + unknown non-family + literal collision
  const agyHigh = await resolveExactEffortRoute("antigravity", "gemini-3.7-flash", {
    reasoning_effort: "high",
  });
  expect(agyHigh && agyHigh.wireId).toBe("gemini-3.7-flash-high");
  expect(agyHigh && agyHigh.effort).toBe("high");

  // Static Antigravity alias without explicit effort defers to static alias resolution
  expect(await resolveExactEffortRoute("antigravity", "gemini-3.7-flash", {})).toBeNull();
  expect(resolveAntigravityModelId("gemini-3.7-flash")).toBe("gemini-3.7-flash-tiered");

  // Dynamic Antigravity family without explicit effort resolves its declared default tier
  const agyDynDefault = await resolveExactEffortRoute("antigravity", "agy-dyn", {});
  expect(agyDynDefault && agyDynDefault.wireId).toBe("agy-dyn-high");
  expect(agyDynDefault && agyDynDefault.effort).toBe("high");

  // Unsupported effort tier fails closed (false -> 400)
  const agyUnsupported = await resolveExactEffortRoute("antigravity", "gemini-3.7-flash", {
    reasoning_effort: "xhigh",
  });
  expect(agyUnsupported).toBe(false);

  // Unknown Antigravity model produces no family and no synthetic aliases
  expect(byId(expanded, "antigravity/agy-unknown-plain")).toBeDefined();
  expect(byId(compact, "antigravity/agy-unknown-plain")).toBeDefined();
  expect(expanded.some((r) => r.id.startsWith("antigravity/agy-unknown-plain-"))).toBe(false);

  // Suffix alone without >=2 corroborated native thinkingLevel rows never forms an Antigravity family
  expect(
    readAntigravityEffortVariants([{ id: "single-tier-high", thinkingLevel: 3 }], undefined).size
  ).toBe(0);

  // Literal base ID wins over virtual Antigravity effort family on collision
  const literalCollisionFamilies = collectEffortFamilies([
    [
      "conn-a",
      [
        { id: "gemini-4-argon", effortVariant: undefined },
        { id: "gemini-4-argon-low", effortVariant: { baseModel: "gemini-4-argon", effort: "low" } },
        { id: "gemini-4-argon-high", effortVariant: { baseModel: "gemini-4-argon", effort: "high" } },
      ],
    ],
  ]);
  expect(literalCollisionFamilies.has("gemini-4-argon")).toBe(false);
});

test("admin provider catalog strips base effort tiers on generated and static aliases while keeping literal collisions", () => {
  const inventories: any[] = [
    {
      providerId: "alpha",
      nodeId: null,
      prefix: "alpha",
      models: [
        { id: "vendor/thinker", origin: "synced", supportedThinkingEfforts: ["low", "high"] },
        { id: "vendor/thinker-high", origin: "synced", name: "Literal High" },
      ],
    },
    {
      providerId: "glm",
      nodeId: null,
      prefix: "glm",
      models: [
        { id: "glm-5.3", origin: "built-in", supportedThinkingEfforts: ["low", "high", "max"] },
        { id: "glm-5.3-high", origin: "built-in", supportedThinkingEfforts: ["high"] },
      ],
    },
    {
      providerId: "opencode-go",
      nodeId: null,
      prefix: "opencode-go",
      models: [
        { id: "hy3", origin: "built-in" },
        { id: "hy3-none", origin: "built-in" },
        { id: "grok-4.5", origin: "built-in" },
        { id: "grok-4.5-high", origin: "built-in" },
      ],
    },
  ];

  expandAdminInventories(inventories, {}, new Map());

  const alphaModels = inventories[0].models;
  const generatedLow = alphaModels.find((m: any) => m.id === "vendor/thinker-low");
  expect(generatedLow).toBeDefined();
  expect(generatedLow.origin).toBe("generated-effort");
  expect(generatedLow.baseLocalId).toBe("vendor/thinker");
  expect(generatedLow.effortConfigurable).toBe(false);
  expect(generatedLow.fixedEffort).toBe("low");
  expect(generatedLow.supportedThinkingEfforts).toBeUndefined();
  expect(generatedLow.capabilities?.effort_tiers).toBeUndefined();
  expect(generatedLow.capabilities?.effort_configurable).toBe(false);

  // Synced literal model wins on collision
  const literalHigh = alphaModels.filter((m: any) => m.id === "vendor/thinker-high");
  expect(literalHigh).toHaveLength(1);
  expect(literalHigh[0].origin).toBe("synced");
  expect(literalHigh[0].fixedEffort).toBeUndefined();

  // Static GLM & OpenCode aliases are marked fixed-effort with no inherited supportedThinkingEfforts
  const glmHigh = inventories[1].models.find((m: any) => m.id === "glm-5.3-high");
  expect(glmHigh.effortConfigurable).toBe(false);
  expect(glmHigh.fixedEffort).toBe("high");
  expect(glmHigh.baseLocalId).toBe("glm-5.3");
  expect(glmHigh.supportedThinkingEfforts).toBeUndefined();
  expect(glmHigh.supportsThinking).toBe(true);

  const hy3None = inventories[2].models.find((m: any) => m.id === "hy3-none");
  expect(hy3None.effortConfigurable).toBe(false);
  expect(hy3None.fixedEffort).toBe("none");
  expect(hy3None.baseLocalId).toBe("hy3");
  expect(hy3None.supportsThinking).toBe(false);

  const grokHigh = inventories[2].models.find((m: any) => m.id === "grok-4.5-high");
  expect(grokHigh.effortConfigurable).toBe(false);
  expect(grokHigh.fixedEffort).toBe("high");
  expect(grokHigh.baseLocalId).toBe("grok-4.5");
  expect(grokHigh.supportsThinking).toBe(true);
});

import "./helpers/test-secrets";
import { expect, test } from "bun:test";
import { createAdminApi } from "../server/admin";
import { getThinkingBudgetConfig } from "../open-sse/services/thinkingBudget";
import { getProviderErrorRuleMatch } from "../open-sse/config/providerErrorRules";
import { getSettings } from "../src/lib/db/settings";
import { resolveResilienceSettings } from "../src/lib/resilience/settings";

test("PATCH /settings accepts and hot-reloads thinkingBudget, providerErrorRules, codexServiceTier, visionBridge, webSearchRouteModel, and streamRecovery", async () => {
  const app = createAdminApi();

  const patchRes = await app.request("/settings", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      thinkingBudget: {
        mode: "custom",
        customBudget: 16384,
        effortLevel: "high",
      },
      codexServiceTier: {
        enabled: true,
        tier: "priority",
      },
      providerErrorRules: {
        "codebuddy-cn": [
          {
            status: 400,
            match: "code 6000",
            scope: "model",
            reason: "quota_exhausted",
            cooldownMs: 180000,
          },
        ],
      },
      visionBridgeEnabled: true,
      visionBridgeModel: "antigravity/gemini-3-flash",
      webSearchRouteModel: "antigravity/gemini-3-flash",
      resilienceSettings: {
        streamRecovery: {
          enabled: true,
          continueMidStream: true,
          throughputWatchdog: {
            enabled: true,
          },
        },
      },
    }),
  });

  expect(patchRes.status).toBe(200);

  // 1. Thinking budget hot-reloaded in open-sse
  const tb = getThinkingBudgetConfig();
  expect(tb.mode).toBe("custom");
  expect(tb.customBudget).toBe(16384);
  expect(tb.effortLevel).toBe("high");

  // 2. Operator providerErrorRules hot-reloaded in open-sse
  const match = getProviderErrorRuleMatch("codebuddy-cn", 400, {}, "upstream error code 6000");
  expect(match).toEqual({
    reason: "quota_exhausted",
    scope: "model",
    cooldownMs: 180000,
  });

  // 3. Stored settings + streamRecovery resolved
  const stored = (await getSettings()) as Record<string, unknown>;
  expect(stored.visionBridgeEnabled).toBe(true);
  expect(stored.visionBridgeModel).toBe("antigravity/gemini-3-flash");
  expect(stored.webSearchRouteModel).toBe("antigravity/gemini-3-flash");

  const resilience = resolveResilienceSettings(stored);
  expect(resilience.streamRecovery.enabled).toBe(true);
  expect(resilience.streamRecovery.continueMidStream).toBe(true);
  expect(resilience.streamRecovery.throughputWatchdog.enabled).toBe(true);
});

test("PATCH /connections/:id sets per-account excludedModels and dry-run skips excluded accounts", async () => {
  const admin1 = createAdminApi();
  const { createAdminApi2 } = await import("../server/admin2");
  const admin2 = createAdminApi2();
  const { createProviderConnection } = await import("../src/lib/db/providers");

  const c1 = (await createProviderConnection({
    provider: "anthropic",
    authType: "oauth",
    name: "claude-sonnet-only",
    accessToken: "tok-1",
    priority: 1,
    isActive: true,
  })) as { id: string };

  const c2 = (await createProviderConnection({
    provider: "anthropic",
    authType: "oauth",
    name: "claude-full-access",
    accessToken: "tok-2",
    priority: 2,
    isActive: true,
  })) as { id: string };

  const patchRes = await admin1.request(`/connections/${c1.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      excludedModels: ["claude-opus-*"],
    }),
  });
  expect(patchRes.status).toBe(200);

  const listRes = await admin1.request("/connections");
  const listData = (await listRes.json()) as {
    connections: Array<{ id: string; excludedModels?: string[] }>;
  };
  const found = listData.connections.find((c) => c.id === c1.id);
  expect(found?.excludedModels).toEqual(["claude-opus-*"]);

  const dryRes = await admin2.request("/routing/dry-run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ target: "anthropic/claude-opus-4-8" }),
  });
  expect(dryRes.status).toBe(200);
  const dry = (await dryRes.json()) as {
    winner: { accountId: string; accountName: string | null } | null;
    steps: Array<{ candidates: Array<{ id: string; eligible: boolean; reason: string }> }>;
  };
  expect(dry.winner?.accountId).toBe(c2.id);
  const c1Cand = dry.steps[0]?.candidates.find((c) => c.id === c1.id);
  expect(c1Cand?.eligible).toBe(false);
  expect(c1Cand?.reason).toContain("model rule");
});

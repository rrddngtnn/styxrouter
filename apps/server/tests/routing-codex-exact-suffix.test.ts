import { expect, test } from "bun:test";

const { createProviderConnection } = await import("../src/lib/db/providers.ts");
const { replaceSyncedAvailableModelsForConnection } = await import("../src/lib/db/models.ts");
const { getModelInfoCore } = await import("../open-sse/services/model.ts");

test("Codex preference accepts a live catalog's exact effort-like model ID", async () => {
  const codex = await createProviderConnection({ provider: "codex", authType: "oauth", accessToken: "test", isActive: true } as any);
  const openai = await createProviderConnection({ provider: "openai", authType: "apikey", apiKey: "test", isActive: true } as any);
  await replaceSyncedAvailableModelsForConnection("codex", codex.id, [{ id: "gpt-5.5-high", name: "Exact" }]);
  await replaceSyncedAvailableModelsForConnection("openai", openai.id, [{ id: "gpt-5.5-high", name: "Exact" }]);
  const result = await getModelInfoCore("gpt-5.5-high", null);
  expect(result.provider).toBe("codex");
  expect(result.model).toBe("gpt-5.5-high");
});

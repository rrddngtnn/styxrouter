import { expect, test } from "bun:test";

const { createProviderConnection, updateProviderConnection } = await import("../src/lib/db/providers.ts");
const { replaceSyncedAvailableModelsForConnection } = await import("../src/lib/db/models.ts");
const { getModelInfoCore } = await import("../open-sse/services/model.ts");

test("bare Codex model falls back to an active synced provider rather than inactive OpenAI", async () => {
  const codex = await createProviderConnection({ provider: "codex", authType: "oauth", accessToken: "test", isActive: true } as any);
  await createProviderConnection({ provider: "openai", authType: "apikey", apiKey: "test", isActive: false } as any);
  const alternative = await createProviderConnection({ provider: "anthropic", authType: "apikey", apiKey: "test", isActive: true } as any);
  await replaceSyncedAvailableModelsForConnection("codex", codex.id, [{ id: "unrelated-model", name: "Other" }]);
  await replaceSyncedAvailableModelsForConnection("anthropic", alternative.id, [{ id: "gpt-5.5", name: "Model" }]);
  expect((await getModelInfoCore("gpt-5.5", null)).provider).toBe("anthropic");
  await updateProviderConnection(alternative.id, { isActive: false });
  expect((await getModelInfoCore("gpt-5.5", null)).errorType).toBe("model_not_found");
});

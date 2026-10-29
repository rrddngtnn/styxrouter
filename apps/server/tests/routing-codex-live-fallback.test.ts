import { expect, test } from "bun:test";

const { createProviderConnection } = await import("../src/lib/db/providers.ts");
const { replaceSyncedAvailableModelsForConnection } = await import("../src/lib/db/models.ts");
const { getModelInfo } = await import("../src/sse/services/model.ts");

test("bare Terra falls back to an active provider advertising it when Codex catalog excludes it", async () => {
  const codex = await createProviderConnection({ provider: "codex", authType: "oauth", accessToken: "test", isActive: true } as any);
  const openai = await createProviderConnection({ provider: "openai", authType: "apikey", apiKey: "test", isActive: true } as any);
  await replaceSyncedAvailableModelsForConnection("codex", codex.id, [{ id: "gpt-5.6-sol", name: "Sol" }]);
  await replaceSyncedAvailableModelsForConnection("openai", openai.id, [{ id: "gpt-6.1-terra", name: "Terra" }]);
  const result = await getModelInfo("gpt-6.1-terra");
  expect(result.provider).toBe("openai");
  expect(result.model).toBe("gpt-6.1-terra");
  expect((await getModelInfo("codex/gpt-6.1-terra")).errorType).toBe("model_not_found");

  await replaceSyncedAvailableModelsForConnection("codex", codex.id, [{ id: "gpt-6.1-terra", name: "Terra" }]);
  expect((await getModelInfo("gpt-6.1-terra")).provider).toBe("codex");
  expect((await getModelInfo("openai/gpt-6.1-terra")).provider).toBe("openai");
});

import { expect, test } from "bun:test";
import { addCustomModel, replaceSyncedAvailableModelsForConnection } from "../src/lib/db/models.ts";
import { createProviderConnection, updateProviderConnection } from "../src/lib/db/providers.ts";
import { getProviderCredentials } from "../src/sse/services/auth.ts";
import { getModelInfo } from "../src/sse/services/model.ts";
import { isModelAdvertisedByConnection } from "../src/domain/connectionModelRules.ts";

test("manual Codex entries cannot bypass a known active account catalog", async () => {
  const account = await createProviderConnection({ provider: "codex", authType: "oauth", accessToken: "fixture", isActive: true } as any);
  await replaceSyncedAvailableModelsForConnection("codex", account.id, [{ id: "available-fixture", name: "Available" }, { id: "literal-high", name: "Exact" }]);
  await addCustomModel("codex", "manual-absent-fixture", "Manual", "manual", "embeddings", ["embeddings"]);
  for (const id of ["manual-absent-fixture", "manual-absent-fixture-high"]) {
    expect(isModelAdvertisedByConnection(id, new Set(["available-fixture", "literal-high"]), "codex")).toBe(false);
    expect((await getModelInfo(`codex/${id}`)).errorType).toBe("model_not_found");
  }
  await addCustomModel("codex", "available-fixture", "Overlay", "manual", "embeddings", ["embeddings"]);
  expect((await getModelInfo("codex/available-fixture")).apiFormat).toBe("embeddings");
  expect((await getModelInfo("codex/available-fixture-high")).provider).toBe("codex");
  expect((await getModelInfo("codex/literal-high")).model).toBe("literal-high");
  expect((await getProviderCredentials("codex", null, [account.id], "manual-absent-fixture"))?.connectionId).toBeUndefined();
  const second = await createProviderConnection({ provider: "codex", authType: "oauth", accessToken: "fixture-2", isActive: true } as any);
  await replaceSyncedAvailableModelsForConnection("codex", second.id, [{ id: "manual-absent-fixture", name: "Live" }]);
  expect((await getModelInfo("codex/manual-absent-fixture")).provider).toBe("codex");
  expect((await getProviderCredentials("codex", null, [account.id, second.id], "manual-absent-fixture"))?.connectionId).toBe(second.id);
  await updateProviderConnection(account.id, { isActive: false });
  await updateProviderConnection(second.id, { isActive: false });
  expect((await getModelInfo("codex/manual-absent-fixture")).provider).toBe("codex");
});

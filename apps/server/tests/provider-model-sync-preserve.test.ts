import { expect, test } from "bun:test";
import { addCustomModel, getCustomModels, replaceCustomModels } from "../src/lib/db/models";

test("discovery replacement preserves manual models and their metadata", async () => {
  const provider = "provider-model-sync-fixture";
  await addCustomModel(provider, "manual-only", "Manual");
  await addCustomModel(provider, "shared", "Manual Shared", "manual", "embeddings", ["embeddings"]);
  await replaceCustomModels(provider, [{ id: "shared", name: "Discovered" }, { id: "discovered", name: "Discovered only" }]);
  const rows: any[] = await getCustomModels(provider);
  expect(rows.find(row => row.id === "manual-only")).toMatchObject({ source: "manual", name: "Manual" });
  expect(rows.find(row => row.id === "shared")).toMatchObject({ source: "manual", name: "Manual Shared", apiFormat: "embeddings" });
  expect(rows.find(row => row.id === "discovered")).toMatchObject({ source: "auto-sync" });
});

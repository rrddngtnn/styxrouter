import { expect, test } from "bun:test";
import * as providerModels from "../server/providerModels.ts";

test("embedding registry provenance is scoped to exact providers and does not overwrite existing models", () => {
  const inventories: any[] = [
    { providerId: "openai", nodeId: null, prefix: "openai", models: [{ id: "text-embedding-3-small", origin: "manual" }] },
    { providerId: "nebius", nodeId: null, prefix: "nebius", models: [] },
    { providerId: "node", nodeId: "node", prefix: "openai", models: [] },
  ];
  expect(typeof (providerModels as any).expandEmbeddingInventory).toBe("function");
  (providerModels as any).expandEmbeddingInventory(inventories);
  expect(inventories[0].models.find((m: any) => m.id === "text-embedding-3-small").origin).toBe("manual");
  expect(inventories[0].models.find((m: any) => m.id === "text-embedding-3-large")).toMatchObject({ origin: "embedding-registry" });
  expect(inventories[1].models.find((m: any) => m.id === "Qwen/Qwen3-Embedding-8B")).toMatchObject({ origin: "embedding-registry" });
  expect(inventories[2].models).toEqual([]);
});

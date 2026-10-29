import { expect, test } from "bun:test";
import { expandSpecialtyInventory } from "../server/providerModels.ts";

test("specialty sources retain explicit provider ownership and existing rows", () => {
  const inventories: any[] = [
    { providerId: "openai", nodeId: null, prefix: "openai", models: [{ id: "whisper-1", origin: "manual" }] },
    { providerId: "cohere", nodeId: null, prefix: "cohere", models: [] },
    { providerId: "node", nodeId: "node", prefix: "openai", models: [] },
  ];
  expandSpecialtyInventory(inventories);
  expect(inventories[0].models.find((m: any) => m.id === "whisper-1").origin).toBe("manual");
  expect(inventories[0].models.some((m: any) => m.origin === "image-registry")).toBe(true);
  expect(inventories[0].models.some((m: any) => m.origin === "moderation-registry")).toBe(true);
  expect(inventories[1].models.some((m: any) => m.origin === "rerank-registry")).toBe(true);
  expect(inventories[2].models).toEqual([]);
});

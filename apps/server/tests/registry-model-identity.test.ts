import { expect, test } from "bun:test";
import { REGISTRY } from "../open-sse/config/providers/index.ts";
import { normalizeSyncedAvailableModels } from "../src/lib/db/models/synced.ts";
import { mergeModelsWithCustomPrecedence } from "../src/lib/providers/modelMetadataPrecedence.ts";
import { dedupeExactCatalogIds } from "../src/app/api/v1/models/catalogDedupe.ts";

test("discovery identity is exact and local to each provider/account", () => {
  const models = [{ id: "Vendor/Model", name: "Shared name" }, { id: "Vendor/Model", name: "Updated" }, { id: "Vendor/Model-high", name: "Shared name" }, { id: "vendor/model", name: "Shared name" }];
  expect(normalizeSyncedAvailableModels(models, "openai").map(m => m.id)).toEqual(["Vendor/Model", "Vendor/Model-high", "vendor/model"]);
  expect(normalizeSyncedAvailableModels(models, "codex").length).toBe(3);
  const merged = mergeModelsWithCustomPrecedence([{ id: "model", name: "Discovered", supportsTools: true }], [{ id: "model", name: "Manual", supportsVision: false }]);
  expect(merged).toEqual([{ id: "model", name: "Manual", supportsTools: true, supportsVision: false }]);
  const rows = [{ id: "p/model" }, { id: "p/model" }, { id: "q/model" }, { id: "p/model-high" }, { id: "p/audio", type: "audio", subtype: "speech" }, { id: "p/audio", type: "audio", subtype: "transcription" }];
  expect(dedupeExactCatalogIds(rows)).toEqual([rows[0], ...rows.slice(2)]);
});

test("each canonical provider registry has unique exact model IDs", () => {
  for (const [id, provider] of Object.entries(REGISTRY)) {
    if (id !== provider.id) continue; // provider aliases intentionally share entries
    const seen = new Set<string>();
    for (const model of provider.models || []) {
      expect({ provider: id, model: model.id, duplicate: seen.has(model.id) }).toEqual({ provider: id, model: model.id, duplicate: false });
      seen.add(model.id);
    }
  }
});

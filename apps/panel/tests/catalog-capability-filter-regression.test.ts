import { expect, test } from "bun:test";
import { extractCatalogCapabilities } from "../src/pages/Models.tsx";

// Inventory mode (/api/admin/provider-catalog -> buildScopedInventoryRows) spreads raw
// stored model rows, which carry TOP-LEVEL supportsVision / supportsTools (see
// server customModels storage) and NO `capabilities` nesting. The served /v1/models path
// nests them (catalogVision.ts), but the inventory path does not. The capability filter
// dropdown must recognise both shapes or it drops vision/tools models in inventory mode.
test("capability extraction honours top-level supportsVision and supportsTools like it does supportsThinking", () => {
  expect(extractCatalogCapabilities({ id: "p/vis", owned_by: "p", supportsVision: true } as never)).toContain("Vision");
  expect(extractCatalogCapabilities({ id: "p/tool", owned_by: "p", supportsTools: true } as never)).toContain("Tools");
  // Reasoning already works top-level; keep it covered to prove the symmetry.
  expect(extractCatalogCapabilities({ id: "p/rez", owned_by: "p", supportsThinking: true } as never)).toContain("Reasoning");
  // An explicit top-level false must not spuriously add the tag.
  expect(extractCatalogCapabilities({ id: "p/plain", owned_by: "p", supportsVision: false, supportsTools: false } as never)).toEqual([]);
});

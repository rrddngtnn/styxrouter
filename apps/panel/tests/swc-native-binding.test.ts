import { expect, test } from "bun:test";
import { createRequire } from "node:module";

test("panel SWC plugin loads and executes its native binding under Bun", () => {
  const panelRequire = createRequire(import.meta.url);
  const pluginRequire = createRequire(panelRequire.resolve("@vitejs/plugin-react-swc"));
  const swc = pluginRequire("@swc/core");
  expect(swc.transformSync("const value = 1", {}).code).toContain("value");
});

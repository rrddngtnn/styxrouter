import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { extractCatalogCapabilities, formatContextTokens, ModelEditor } from "../src/pages/Models.tsx";

test("model editor exposes token input, tri-state capabilities and context presets", () => {
  const html = renderToStaticMarkup(<ModelEditor model={{ provider: "codex", modelId: "gpt-5", contextWindow: 256000, supportsThinking: true, supportsVision: true, supportsTools: true, overrides: { contextWindow: 256000, supportsThinking: null, supportsVision: null, supportsTools: null } }} onSaved={() => {}} />);
  for (const text of ["Context window", "Reasoning", "Vision", "Tools", "Automatic", "1M", "GPT 256K", "Save", "256000"]) expect(html).toContain(text);
});

test("formatContextTokens and extractCatalogCapabilities surface compact context and capability badges", () => {
  expect(formatContextTokens(1048576)).toBe("1M");
  expect(formatContextTokens(256000)).toBe("256K");
  expect(formatContextTokens(null)).toBe("—");
  expect(
    extractCatalogCapabilities({
      id: "antigravity/gemini-4-argon",
      owned_by: "antigravity",
      thinking: true,
      capabilities: { vision: true, tool_calling: true },
    }),
  ).toEqual(["Reasoning", "Vision", "Tools"]);
});

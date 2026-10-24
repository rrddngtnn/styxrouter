import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ModelEditor } from "../src/pages/Models.tsx";

test("model editor exposes token input, tri-state capabilities and context presets", () => {
  const html = renderToStaticMarkup(<ModelEditor model={{ provider: "codex", modelId: "gpt-5", contextWindow: 256000, supportsThinking: true, supportsVision: true, supportsTools: true, overrides: { contextWindow: 256000, supportsThinking: null, supportsVision: null, supportsTools: null } }} onSaved={() => {}} />);
  for (const text of ["Context window", "Reasoning", "Vision", "Tools", "Automatic", "1M", "GPT 256K", "Save", "256000"]) expect(html).toContain(text);
});

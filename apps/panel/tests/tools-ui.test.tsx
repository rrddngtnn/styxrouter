import { expect, test } from "bun:test";
import { buildSnippets, TOOLS } from "../src/pages/Tools.tsx";

test("tools catalog includes Claude Code, Codex, OpenCode, Aider, IDE, Python SDK and cURL with attached file headers", () => {
  expect(TOOLS.map((t) => t.id)).toEqual([
    "claude-code",
    "codex",
    "opencode",
    "aider",
    "ide",
    "python",
    "curl",
  ]);
  const py = buildSnippets("python", "http://127.0.0.1:20128", "sk-test", "antigravity/gemini-4-argon-high");
  expect(py[0]?.file).toBe("main.py");
  expect(py[0]?.body).toContain("http://127.0.0.1:20128/v1");
  expect(py[0]?.body).toContain("antigravity/gemini-4-argon-high");
});

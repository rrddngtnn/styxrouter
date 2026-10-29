import { expect, test } from "bun:test";
import { CodeBuddyCnExecutor } from "../open-sse/executors/codebuddy-cn";

test("CodeBuddy preserves non-system messages and replaces agent system content", () => {
  const executor = new CodeBuddyCnExecutor();
  const input = { messages: [{ role: "system", content: "You are Claude Code" }, { role: "user", content: "hello" }] };
  const result = executor.transformRequest("test-model", input, true, {} as never) as { messages: typeof input.messages };
  expect(result.messages).toEqual([{ role: "system", content: "You are a helpful AI assistant that helps with software engineering tasks." }, { role: "user", content: "hello" }]);
});

test("CodeBuddy preserves user messages when no soul or system message is provided", () => {
  const executor = new CodeBuddyCnExecutor();
  const input = { messages: [{ role: "user", content: "hello" }] };
  const result = executor.transformRequest("test-model", input, true, {} as never) as { messages: typeof input.messages };
  expect(result.messages).toEqual(input.messages);
});

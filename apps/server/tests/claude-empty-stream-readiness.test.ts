import { expect, test } from "bun:test";
import { ensureStreamReadiness } from "../open-sse/utils/streamReadiness.ts";

const frame = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`;
const start = frame({ type: "message_start", message: { id: "msg_empty", model: "claude-opus-4-8", usage: { input_tokens: 97653, output_tokens: 0 }, content: [] } });
const end = (reason = "end_turn") => frame({ type: "message_delta", delta: { stop_reason: reason }, usage: { output_tokens: 0 } }) + frame({ type: "message_stop" });
const check = (sse: string) => ensureStreamReadiness(new Response(sse, { headers: { "Content-Type": "text/event-stream" } }), { timeoutMs: 1000, provider: "claude", model: "claude-opus-4-8" });

test("Claude metadata-only end_turn fails readiness before a successful stop reaches the client", async () => {
  const result = await check(start + end());
  expect(result.ok).toBe(false);
  expect(result.response.status).toBe(502);
  if (!result.ok) expect(result.code).toBe("STREAM_EARLY_EOF");
});

test("Claude empty content blocks do not establish readiness", async () => {
  const result = await check(start + frame({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }) + frame({ type: "content_block_stop", index: 0 }) + end());
  expect(result.ok).toBe(false);
});

test("Claude readiness buffers metadata across separate reads", async () => {
  const encoder = new TextEncoder();
  const parts = [start.slice(0, 11), start.slice(11), end()];
  const response = new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = parts.shift();
      if (next === undefined) controller.close();
      else controller.enqueue(encoder.encode(next));
    },
  }));
  const result = await ensureStreamReadiness(response, { timeoutMs: 1000 });
  expect(result.ok).toBe(false);
});

test("non-Claude bootstrap readiness behavior stays unchanged", async () => {
  const sse = frame({ choices: [{ delta: { role: "assistant" }, finish_reason: null }] });
  const result = await check(sse);
  expect(result.ok).toBe(true);
  expect(await result.response.text()).toBe(sse);
});

test("Claude message_start followed by EOF is not ready", async () => {
  const result = await check(start);
  expect(result.ok).toBe(false);
});

test("Claude text output passes readiness and preserves buffered frames", async () => {
  const sse = start + frame({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hello" } }) + end();
  const result = await check(sse);
  expect(result.ok).toBe(true);
  expect(await result.response.text()).toBe(sse);
});

test("Claude tool and reasoning output remain ready", async () => {
  for (const payload of [
    { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tool_1", name: "lookup", input: {} } },
    { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "reasoning" } },
  ]) {
    const result = await check(start + frame(payload) + end());
    expect(result.ok).toBe(true);
    await result.response.body?.cancel();
  }
});

test("Claude legitimate empty max_tokens is preserved", async () => {
  const result = await check(start + end("max_tokens"));
  expect(result.ok).toBe(true);
  await result.response.body?.cancel();
});

test("Claude structured error after metadata is not committed as success", async () => {
  const result = await check(start + frame({ type: "error", error: { type: "overloaded_error", message: "upstream overloaded" } }));
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.upstreamDiagnostic).toBe("upstream overloaded");
});

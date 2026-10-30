import { expect, test } from "bun:test";
import { openaiResponsesToOpenAIResponse } from "../open-sse/translator/response/openai-responses.ts";

// Minimal state matching initState(FORMATS.OPENAI_RESPONSES) shape for the
// Responses -> OpenAI Chat Completions streaming translator. Built inline to
// avoid importing translator/index.ts, which pulls in the DB layer guarded
// against non-isolated imports.
function makeState(): Record<string, unknown> {
  return {
    messageId: null,
    model: null,
    toolCalls: new Map(),
    finishReason: null,
    finishReasonSent: false,
    usage: null,
    started: false,
  };
}

// OpenAI's Responses API emits `response.incomplete` (NOT `response.completed`)
// as the terminal event when generation stopped early — most commonly because
// `max_output_tokens` was reached, or content was truncated. The Chat
// Completions equivalent finish_reason is "length". A client that sent a small
// max_tokens and relies on finish_reason to know the turn was truncated (to
// continue it) must see "length", not "stop".
test("response.incomplete(max_output_tokens) maps to finish_reason length", () => {
  const state = makeState();
  openaiResponsesToOpenAIResponse({ type: "response.output_text.delta", delta: "Hello" }, state);
  const out = openaiResponsesToOpenAIResponse(
    {
      type: "response.incomplete",
      response: {
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
      },
    },
    state
  );

  const chunks = Array.isArray(out) ? out : out == null ? [] : [out];
  const finalWithReason = chunks.find(
    (c: any) => c?.choices?.[0]?.finish_reason != null
  ) as any;

  expect(finalWithReason).toBeDefined();
  expect(finalWithReason.choices[0].finish_reason).toBe("length");
  // Usage must be carried through on the terminal chunk.
  expect(finalWithReason.usage?.completion_tokens).toBe(20);
});

// A plain content-filter / other-reason incomplete should still terminate the
// stream with a real finish_reason (never silently emit "stop" via the flush
// fallback, and never leave the stream un-terminated).
test("response.incomplete still emits a terminal finish_reason", () => {
  const state = makeState();
  openaiResponsesToOpenAIResponse({ type: "response.output_text.delta", delta: "Hi" }, state);
  const out = openaiResponsesToOpenAIResponse(
    {
      type: "response.incomplete",
      response: { status: "incomplete", incomplete_details: { reason: "content_filter" } },
    },
    state
  );
  const chunks = Array.isArray(out) ? out : out == null ? [] : [out];
  const finalWithReason = chunks.find((c: any) => c?.choices?.[0]?.finish_reason != null);
  expect(finalWithReason).toBeDefined();
});

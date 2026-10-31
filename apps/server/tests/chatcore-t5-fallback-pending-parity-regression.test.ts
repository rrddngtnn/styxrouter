import "./helpers/test-secrets";
import { expect, test } from "bun:test";
import { registerExecutor } from "../open-sse/executors/registry";
import { initTranslators } from "../open-sse/translator/index";
import { handleChatCore } from "../open-sse/handlers/chatCore";
import {
  clearPendingRequests,
  getPendingRequests,
  getCompletedDetails,
  getPendingById,
} from "../src/lib/usage/usageHistory";

// A fake executor that fails the FIRST (primary) model with a model-unavailable
// 404 and then serves a 200 for the T5 family-fallback sibling. This drives the
// real chatCore "providerFailure -> intra-family fallback succeeds -> fall
// through to the success path" branch end-to-end.
let finishFallbackStream: (() => void) | null = null;

function makeFakeExecutor(primary: string) {
  return {
    getProvider: () => "anthropic",
    async execute(input: { model: string; stream?: boolean; body?: { stream?: boolean } }) {
      if (input.model === primary) {
        return {
          response: new Response(
            JSON.stringify({ type: "error", error: { type: "not_found_error", message: "model not found" } }),
            { status: 404, headers: { "content-type": "application/json" } }
          ),
          url: "https://api.anthropic.com/v1/messages",
          headers: {},
          transformedBody: {},
        };
      }
      if (input.stream || input.body?.stream) {
        const enc = new TextEncoder();
        const streamBody = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              enc.encode(
                'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_s1","type":"message","role":"assistant","model":"claude-opus-4-7","content":[],"stop_reason":null,"usage":{"input_tokens":1,"output_tokens":0}}}\n\n' +
                  'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n' +
                  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}\n\n'
              )
            );
            finishFallbackStream = () => {
              controller.enqueue(
                enc.encode(
                  'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n' +
                    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\n' +
                    'event: message_stop\ndata: {"type":"message_stop"}\n\n'
                )
              );
              controller.close();
            };
          },
        });
        return {
          response: new Response(streamBody, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
          url: "https://api.anthropic.com/v1/messages",
          headers: {},
          transformedBody: {},
        };
      }
      // Fallback sibling succeeds with a minimal valid Claude non-streaming body.
      return {
        response: new Response(
          JSON.stringify({
            id: "msg_1",
            type: "message",
            role: "assistant",
            model: input.model,
            content: [{ type: "text", text: "ok" }],
            stop_reason: "end_turn",
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        ),
        url: "https://api.anthropic.com/v1/messages",
        headers: {},
        transformedBody: {},
      };
    },
  };
}

test("T5 family fallback success records a completed 200 detail (no double-decrement)", async () => {
  await initTranslators();
  try {
    registerExecutor("anthropic", makeFakeExecutor("claude-opus-4.8") as never);
  } catch {
    /* already registered in a prior run within this isolated process */
  }
  clearPendingRequests();

  const connectionId = "conn-t5";
  const res = await (handleChatCore as any)({
    body: { model: "anthropic/claude-opus-4.8", messages: [{ role: "user", content: "hi" }], stream: false },
    modelInfo: { provider: "anthropic", model: "claude-opus-4.8", targetFormat: "claude", apiFormat: "claude" },
    credentials: { connectionId, accessToken: "fake-token", authType: "oauth", providerSpecificData: {} },
    log: null,
    clientRawRequest: {
      endpoint: "/v1/messages",
      headers: new Headers({ "content-type": "application/json" }),
      body: { model: "anthropic/claude-opus-4.8", messages: [{ role: "user", content: "hi" }] },
    },
    connectionId,
    skipResourcePressureGuard: true,
  });

  // The request ultimately SUCCEEDED via the family-fallback sibling.
  expect(res?.response?.status ?? res?.status).toBe(200);

  // No pending request may linger for this connection/model.
  const byModel = getPendingRequests().byModel;
  const anyPending = Object.values(byModel).some((n) => n > 0);
  expect(anyPending).toBe(false);
  expect(getPendingById().size).toBe(0);

  // A successful request MUST leave exactly one completed detail carrying the
  // successful provider response. The double-decrement bug discarded it entirely
  // (FIFO-shifted off at the providerFailure decrement, then the by-id finalize
  // no-op'd), so BEFORE the fix this set was empty.
  const completed = [...getCompletedDetails().values()];
  expect(completed.length).toBe(1);
  expect(completed[0]?.providerResponse).toBeDefined();
  expect(completed[0]?.completedAt).toBeDefined();

  clearPendingRequests();
}, 30000);

test("streaming T5 family fallback finalizes its refreshed pendingScope.id instead of stealing a newer concurrent sibling", async () => {
  await initTranslators();
  clearPendingRequests();

  const connectionId = "conn-t5-stream";
  const { trackPendingRequest } = await import("../src/lib/usage/usageHistory");

  const res = await (handleChatCore as any)({
    body: { model: "anthropic/claude-opus-4.8", messages: [{ role: "user", content: "hi" }], stream: true },
    modelInfo: { provider: "anthropic", model: "claude-opus-4.8", targetFormat: "claude", apiFormat: "claude" },
    credentials: { connectionId, accessToken: "fake-token", authType: "oauth", providerSpecificData: {} },
    log: null,
    clientRawRequest: {
      endpoint: "/v1/messages",
      headers: new Headers({ "content-type": "application/json" }),
      body: { model: "anthropic/claude-opus-4.8", messages: [{ role: "user", content: "hi" }], stream: true },
    },
    connectionId,
    skipResourcePressureGuard: true,
    stream: true,
  });

  // While the fallback stream is still open, register a newer concurrent sibling
  const siblingId = trackPendingRequest("claude-opus-4.8", "anthropic", connectionId, true, {
    correlationId: "newer-sibling",
  });
  expect(typeof siblingId).toBe("string");
  expect(getPendingById().size).toBe(2);

  // Now close the fallback stream and consume it to trigger onStreamComplete -> finalizeStreamRequestLog
  finishFallbackStream?.();
  finishFallbackStream = null;
  expect(res?.response?.status ?? res?.status).toBe(200);
  const response: Response = res?.response ?? res;
  await response.text();

  // The newer sibling must STILL be in pendingById (not stolen by finalizeMostRecentPendingRequest!)
  // and the fallback stream's own refreshedPendingId must have been finalized (size === 1).
  expect(getPendingById().size).toBe(1);
  expect(getPendingById().has(siblingId!)).toBe(true);
  clearPendingRequests();
}, 30000);

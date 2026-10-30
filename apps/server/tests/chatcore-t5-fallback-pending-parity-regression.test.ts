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
function makeFakeExecutor(primary: string) {
  return {
    getProvider: () => "anthropic",
    async execute(input: { model: string }) {
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

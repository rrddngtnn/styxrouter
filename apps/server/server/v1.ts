// Anthropic-style (/v1/messages) and Responses-style (/v1/responses) entry points. Like /v1/chat/completions
// they hand the request to handleChat, which picks the wire format from the URL and translates to the
// provider's format. The key gate in ./auth.ts already runs for every /v1 path.
//
// Streaming: a large prompt can leave the connection silent for longer than a client's first-byte watchdog
// (Claude Code, Codex), so streaming calls are wrapped in the early-keepalive helper, as the upstream routes did.
import { Hono, type Context } from "hono";
import { createSpecialtyApi } from "./specialty.ts";
import { handleChat } from "../src/sse/handlers/chat.ts";
import { SSE_HEARTBEAT_INTERVAL_MS } from "../open-sse/config/constants.ts";
import { resolveStreamFlag } from "../open-sse/utils/aiSdkCompat.ts";
import {
  ANTHROPIC_PING_FRAME,
  OPENAI_RESPONSES_ERROR_FRAME,
  withEarlyStreamKeepalive,
} from "../open-sse/utils/earlyStreamKeepalive.ts";
import { resolveKeepaliveThreshold } from "../open-sse/utils/keepaliveThreshold.ts";
import { OPENAI_RESPONSES_IN_PROGRESS_FRAME } from "../open-sse/utils/sseHeartbeat.ts";
import { generateRequestId } from "../src/shared/utils/requestId.ts";
import { POST as countTokens } from "../src/app/api/v1/messages/count_tokens/route.ts";

const invalid = (c: Context, message: string, status: 400 | 500 = 400) =>
  c.json({ error: { message, type: status === 400 ? "invalid_request_error" : "internal_error" } }, status);

export function createV1Api(ensureTranslators: () => Promise<unknown>) {
  const api = new Hono();
  api.route("/", createSpecialtyApi());

  api.post("/messages", async (c) => {
    await ensureTranslators();
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") return invalid(c, "Request body must be a JSON object");
    try {
      const reply = handleChat(c.req.raw as any, null, body);
      if (!resolveStreamFlag(body.stream, c.req.header("accept") ?? "", "claude")) return await reply;
      return await withEarlyStreamKeepalive(reply, {
        signal: c.req.raw.signal,
        thresholdMs: resolveKeepaliveThreshold(body.model),
        keepaliveFrame: ANTHROPIC_PING_FRAME,
      });
    } catch (e: any) {
      console.error("[STYX]", e?.stack || e);
      return invalid(c, String(e?.message || e), 500);
    }
  });

  // Provider-side count when the connection supports it, local estimate otherwise (handled by the route).
  api.post("/messages/count_tokens", (c) => countTokens(c.req.raw));

  api.post("/responses", async (c) => {
    await ensureTranslators();
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") return invalid(c, "Request body must be a JSON object");
    try {
      if (!resolveStreamFlag(body.stream, c.req.header("accept") ?? "", "openai-responses")) {
        return await handleChat(c.req.raw as any, null, body);
      }
      const correlationId = generateRequestId();
      return await withEarlyStreamKeepalive(handleChat(c.req.raw as any, null, body, correlationId), {
        signal: c.req.raw.signal,
        thresholdMs: resolveKeepaliveThreshold(body.model),
        startupFrame: OPENAI_RESPONSES_IN_PROGRESS_FRAME,
        applicationKeepalive: { frame: OPENAI_RESPONSES_IN_PROGRESS_FRAME, intervalMs: SSE_HEARTBEAT_INTERVAL_MS },
        errorFrame: OPENAI_RESPONSES_ERROR_FRAME,
        correlationId,
      });
    } catch (e: any) {
      console.error("[STYX]", e?.stack || e);
      return invalid(c, String(e?.message || e), 500);
    }
  });

  return api;
}

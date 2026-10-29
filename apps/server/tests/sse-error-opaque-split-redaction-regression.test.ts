import { expect, test } from "bun:test";
import { createRequestLogger } from "../open-sse/utils/requestLogger";
import { createSSEStream } from "../open-sse/utils/stream";
import { protectPipelinePayloads } from "../src/lib/usage/callLogs/format";
import { saveCallLog, getCallLogById } from "../src/lib/usage/callLogs";

test("real SSE error keeps client payload while persisted stream logs redact split opaque URL", async () => {
  const secret = "synthetic-opaque-sse-secret-472";
  const message = `upstream failed https://example.invalid/v1/files/${secret}/content?model=visible`;
  const frame = `data: ${JSON.stringify({ error: { message, type: "server_error", code: "bad_gateway" } })}\n\n`;
  const cut = frame.indexOf("https://") + 4;
  const logger = await createRequestLogger(undefined, undefined, undefined, { enabled: true });
  const source = new ReadableStream<Uint8Array>({ start(c) {
    const enc = new TextEncoder(); c.enqueue(enc.encode(frame.slice(0, cut))); c.enqueue(enc.encode(frame.slice(cut))); c.close();
  }});
  const output = await new Response(source.pipeThrough(createSSEStream({ mode: "translate", sourceFormat: "openai", targetFormat: "openai", reqLogger: logger }))).text();
  expect(output).toContain(secret);
  expect(output).toContain("bad_gateway");
  const pipeline = logger.getPipelinePayloads();
  expect(pipeline?.streamChunks?.provider?.length).toBe(2);
  const safe = JSON.stringify(protectPipelinePayloads(pipeline));
  expect(safe).not.toContain(secret);
  expect(safe).toContain("[REDACTED]");
  await saveCallLog({ id: "sse-split-error", status: 502, provider: "fixture", model: "fixture", error: message, pipelinePayloads: pipeline });
  const detail = await getCallLogById("sse-split-error");
  expect(detail?.detailState).toBe("ready");
  expect(JSON.stringify(detail)).not.toContain(secret);
  expect(JSON.stringify(detail)).toContain("[REDACTED]");
}, 60000);

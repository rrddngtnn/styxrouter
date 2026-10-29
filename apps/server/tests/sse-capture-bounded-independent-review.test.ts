import { expect, test } from "bun:test";
import { createRequestLogger } from "../open-sse/utils/requestLogger";
import { createSSEStream } from "../open-sse/utils/stream";
import { protectPipelinePayloads } from "../src/lib/usage/callLogs/format";

test("large synthetic SSE response keeps response intact and capture bounded", async () => {
  const message = "visible-" + "z".repeat(2_000_000);
  const frame = `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: message }, finish_reason: null }] })}\n\n`;
  const logger = await createRequestLogger(undefined, undefined, undefined, { enabled: true });
  const source = new ReadableStream<Uint8Array>({ start(c) { const enc = new TextEncoder(); for (let i = 0; i < frame.length; i += 8192) c.enqueue(enc.encode(frame.slice(i, i + 8192))); c.close(); } });
  const response = await new Response(source.pipeThrough(createSSEStream({ mode: "translate", sourceFormat: "openai", targetFormat: "openai", reqLogger: logger }))).text();
  expect(response.includes(message)).toBe(true);
  const captured = logger.getPipelinePayloads();
  expect(JSON.stringify(captured).length).toBeLessThan(400_000);
  expect(JSON.stringify(protectPipelinePayloads(captured)).length).toBeLessThan(400_000);
});

test("unicode stream capture respects byte budget without affecting response", async () => {
  const message = "界".repeat(1000);
  const frame = `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: message }, finish_reason: null }] })}\n\n`;
  const logger = await createRequestLogger(undefined, undefined, undefined, { enabled: true, maxStreamChunkBytes: 150 });
  const source = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(frame)); c.close(); } });
  const response = await new Response(source.pipeThrough(createSSEStream({ mode: "translate", sourceFormat: "openai", targetFormat: "openai", reqLogger: logger }))).text();
  expect(response.includes(message)).toBe(true);
  for (const chunks of Object.values(logger.getPipelinePayloads()?.streamChunks ?? {})) {
    const content = (chunks as string[]).filter(chunk => !chunk.startsWith("[stream chunk log truncated"));
    expect(Buffer.byteLength(content.join(""))).toBeLessThanOrEqual(150);
  }
});

test("escaped slash URLs split across chunks are redacted in captured SSE", () => {
  const secret = "opaque-escape-secret-219";
  const frame = `data: {"error":{"message":"https:\\/\\/example.invalid\\/v1\\/files\\/${secret}\\/content"}}\n\n`;
  const captured = { streamChunks: { provider: [frame.slice(0, 20), frame.slice(20)] } };
  expect(JSON.stringify(protectPipelinePayloads(captured))).not.toContain(secret);
});

test("truncated encrypted SSE frame never persists its partial secret and does not alter response", async () => {
  const secret = "synthetic-encrypted-secret-483";
  const frame = `data: ${JSON.stringify({ error: { message: "failure", code: "bad_gateway", encrypted_content: secret + "x".repeat(500) } })}\n\n`;
  const logger = await createRequestLogger(undefined, undefined, undefined, { enabled: true, maxStreamChunkBytes: 150 });
  const source = new ReadableStream<Uint8Array>({ start(c) { const enc = new TextEncoder(); c.enqueue(enc.encode(frame.slice(0, 75))); c.enqueue(enc.encode(frame.slice(75))); c.close(); } });
  const response = await new Response(source.pipeThrough(createSSEStream({ mode: "translate", sourceFormat: "openai", targetFormat: "openai", reqLogger: logger }))).text();
  expect(response).toContain("bad_gateway");
  const captured = logger.getPipelinePayloads();
  expect(JSON.stringify(captured).length).toBeLessThan(1000);
  expect(JSON.stringify(protectPipelinePayloads(captured))).not.toContain(secret);
});

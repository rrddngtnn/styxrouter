import { expect, test } from "bun:test";
import { FORMATS } from "../open-sse/translator/formats.ts";
import { ensureStreamReadiness } from "../open-sse/utils/streamReadiness.ts";
import {
  createStreamController,
  pipeWithDisconnect,
} from "../open-sse/utils/streamHandler.ts";
import { createSSEStream } from "../open-sse/utils/stream.ts";

const sseFrame = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`;
const makeResponse = (chunks: string[]) => {
  const encoder = new TextEncoder();
  const queue = [...chunks];
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        const next = queue.shift();
        if (next === undefined) controller.close();
        else controller.enqueue(encoder.encode(next));
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } }
  );
};
const checkReadiness = (sse: string, provider = "antigravity", model = "gemini-4-hydrogen-high") =>
  ensureStreamReadiness(
    new Response(sse, { headers: { "Content-Type": "text/event-stream" } }),
    { timeoutMs: 1000, provider, model }
  );

test("Antigravity/Gemini zero-output candidate or usage-only stream fails readiness pre-header with 502", async () => {
  const cases = [
    sseFrame({
      response: {
        candidates: [{ content: { role: "model", parts: [{ text: "" }] } }],
        usageMetadata: { promptTokenCount: 74403, cachedContentTokenCount: 72354, totalTokenCount: 74403 },
      },
    }),
    sseFrame({
      response: {
        candidates: [{ content: { role: "model", parts: [] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 74403, candidatesTokenCount: 0, totalTokenCount: 74403 },
      },
    }),
    sseFrame({
      response: {
        usageMetadata: { promptTokenCount: 74403, totalTokenCount: 74403 },
      },
    }),
    sseFrame({
      candidates: [{ content: { role: "model", parts: [] }, finishReason: "STOP" }],
    }),
  ];

  for (const sse of cases) {
    const result = await checkReadiness(sse);
    expect(result.ok).toBe(false);
    expect(result.response.status).toBe(502);
    if (!result.ok) expect(result.code).toBe("STREAM_EARLY_EOF");
  }
});

test("Antigravity error-only response wrapper fails readiness with diagnostic before HTTP 200", async () => {
  const sse = sseFrame({
    response: { error: { code: 503, message: "Upstream temporarily unavailable", status: "UNAVAILABLE" } },
  });
  const result = await checkReadiness(sse);
  expect(result.ok).toBe(false);
  expect(result.response.status).toBe(502);
  if (!result.ok) {
    expect(result.code).toBe("STREAM_EARLY_EOF");
    expect(result.upstreamDiagnostic).toContain("Upstream temporarily unavailable");
  }
});

test("Antigravity buffers empty metadata or standalone thoughtSignature until real output and preserves all frames", async () => {
  const sigOnly = sseFrame({
    response: {
      candidates: [{ content: { role: "model", parts: [{ thoughtSignature: "RsynSig" }] } }],
    },
  });
  const callFrame = sseFrame({
    response: {
      candidates: [
        {
          content: { role: "model", parts: [{ functionCall: { id: "call_1", name: "lookup", args: {} } }] },
          finishReason: "STOP",
        },
      ],
    },
  });
  const encoder = new TextEncoder();
  const chunks = [sigOnly, callFrame];
  const response = new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        const next = chunks.shift();
        if (next === undefined) controller.close();
        else controller.enqueue(encoder.encode(next));
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } }
  );

  const result = await ensureStreamReadiness(response, { timeoutMs: 1000, provider: "antigravity", model: "gemini-4-neon-xhigh" });
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(await result.response.text()).toBe(sigOnly + callFrame);
  }
});

test("Antigravity/Gemini text, thinking, inline image, and legitimate empty terminals pass readiness", async () => {
  const validPayloads = [
    { response: { candidates: [{ content: { role: "model", parts: [{ text: "ok" }] } }] } },
    { response: { candidates: [{ content: { role: "model", parts: [{ thought: true, text: "plan" }] } }] } },
    { response: { candidates: [{ content: { role: "model", parts: [{ inlineData: { mimeType: "image/png", data: "aGVsbG8=" } }] } }] } },
    { response: { candidates: [{ finishReason: "MAX_TOKENS" }] } },
    { response: { candidates: [{ finishReason: "SAFETY" }] } },
    { response: { candidates: [{ finishReason: "MALFORMED_FUNCTION_CALL" }] } },
    { response: { promptFeedback: { blockReason: "SAFETY" } } },
  ];

  for (const payload of validPayloads) {
    const result = await checkReadiness(sseFrame(payload));
    expect(result.ok).toBe(true);
    await result.response.body?.cancel();
  }
});

test("OpenAI empty stream emits structured error + finish_reason before a single [DONE]", async () => {
  const roleChunk = sseFrame({
    id: "chatcmpl-empty",
    object: "chat.completion.chunk",
    created: 1700000000,
    model: "test-model",
    choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
  });

  // Test both split chunks ([role], [[DONE]]) and combined single chunk ([role + [DONE]]).
  for (const inputChunks of [[roleChunk, "data: [DONE]\n\n"], [roleChunk + "data: [DONE]\n\n"]]) {
    const errors: string[] = [];
    const transform = new TransformStream<Uint8Array, Uint8Array>();
    const streamController = createStreamController({
      provider: "antigravity",
      model: "gemini-4-hydrogen-high",
      clientResponseFormat: FORMATS.OPENAI,
      onError: (event) => {
        errors.push(event.message);
      },
    });
    const outStream = pipeWithDisconnect(makeResponse(inputChunks), transform, streamController);

    const output = await new Response(outStream).text();
    const frames = output
      .split(/\r?\n\r?\n/)
      .map((f) => f.trim())
      .filter(Boolean);

    const doneIndexes = frames
      .map((f, idx) => (f === "data: [DONE]" ? idx : -1))
      .filter((idx) => idx >= 0);
    expect(doneIndexes).toEqual([frames.length - 1]);

    const errorIndex = frames.findIndex(
      (f) => f.includes('"finish_reason":"error"') && f.includes("Provider returned empty content")
    );
    expect(errorIndex).toBeGreaterThanOrEqual(0);
    expect(errorIndex).toBeLessThan(doneIndexes[0]);
    expect(errors).toContain("Provider returned empty content");
  }
});

test("Translated zero-output Antigravity SSE surfaces error frame before [DONE] if readiness is bypassed", async () => {
  const emptyAntigravity = sseFrame({
    response: {
      responseId: "resp-empty",
      modelVersion: "gemini-4-hydrogen-high",
      candidates: [{ content: { role: "model", parts: [{ text: "" }] } }],
      usageMetadata: { promptTokenCount: 74403, cachedContentTokenCount: 72354, totalTokenCount: 74403 },
    },
  });

  const sseTransform = createSSEStream({
    mode: "translate",
    targetFormat: FORMATS.ANTIGRAVITY,
    sourceFormat: FORMATS.OPENAI,
    provider: "antigravity",
    model: "gemini-4-hydrogen-high",
  });
  const streamController = createStreamController({
    provider: "antigravity",
    model: "gemini-4-hydrogen-high",
    clientResponseFormat: FORMATS.OPENAI,
  });
  const outStream = pipeWithDisconnect(makeResponse([emptyAntigravity]), sseTransform, streamController);

  const output = await new Response(outStream).text();
  const donePos = output.indexOf("data: [DONE]");
  const errPos = output.indexOf('"finish_reason":"error"');
  expect(errPos).toBeGreaterThanOrEqual(0);
  expect(donePos).toBeGreaterThan(errPos);
  expect(output.indexOf("data: [DONE]", donePos + 1)).toBe(-1);
});

test("Normal OpenAI stream and legitimate empty length terminal pass through with single [DONE] and no error", async () => {
  const cases = [
    [
      sseFrame({ choices: [{ index: 0, delta: { content: "OK" }, finish_reason: null }] }),
      sseFrame({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }),
      "data: [DONE]\n\n",
    ],
    [
      sseFrame({ choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] }),
      sseFrame({ choices: [{ index: 0, delta: {}, finish_reason: "length" }] }),
      "data: [DONE]\n\n",
    ],
  ];

  for (const inputChunks of cases) {
    const errors: string[] = [];
    const transform = new TransformStream<Uint8Array, Uint8Array>();
    const streamController = createStreamController({
      provider: "openai",
      model: "fixture-model",
      clientResponseFormat: FORMATS.OPENAI,
      onError: (event) => {
        errors.push(event.message);
      },
    });
    const outStream = pipeWithDisconnect(makeResponse(inputChunks), transform, streamController);

    const output = await new Response(outStream).text();
    expect(errors).toEqual([]);
    expect(output).not.toContain('"finish_reason":"error"');
    const doneCount = output.match(/data:\s*\[DONE\]/g)?.length ?? 0;
    expect(doneCount).toBe(1);
  }
});

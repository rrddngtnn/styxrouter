import { expect, test } from "bun:test";
import { createSSEStream } from "../open-sse/utils/stream";

const enc = new TextEncoder();

// Reproduces a partial-frame-at-EOF bug: when the upstream's terminal
// `data: [DONE]` marker arrives WITHOUT a trailing blank line, it is left in the
// line buffer and forwarded verbatim by the passthrough flush path, which — unlike
// the transform loop (stream.ts line ~1326) — has no `[DONE]` skip guard. The
// canonical terminator emission then fires again, so the client receives TWO
// `data: [DONE]` markers (and, when no finish_reason was seen upstream, a synthetic
// finish chunk emitted AFTER the first `[DONE]`).
async function run(parts: string[]): Promise<string> {
  const source = new ReadableStream<Uint8Array>({
    start(c) {
      for (const p of parts) c.enqueue(enc.encode(p));
      c.close();
    },
  });
  return await new Response(
    source.pipeThrough(createSSEStream({ mode: "passthrough", clientResponseFormat: "openai" }))
  ).text();
}

const doneCount = (out: string) =>
  (out.match(/data: \[DONE\]/g) || []).length;

test("passthrough terminal [DONE] without trailing newline is not duplicated (after a finish chunk)", async () => {
  const finish = `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`;
  const out = await run([finish, "data: [DONE]"]);
  expect(doneCount(out)).toBe(1);
});

test("passthrough terminal [DONE] without trailing newline is not duplicated (after content, synthetic finish)", async () => {
  const content = `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "hi" }, finish_reason: null }] })}\n\n`;
  const out = await run([content, "data: [DONE]"]);
  expect(doneCount(out)).toBe(1);
  // The synthetic finish chunk (emitted because no finish_reason was seen) must come
  // BEFORE the single [DONE], never after it.
  const doneIdx = out.indexOf("data: [DONE]");
  const finishIdx = out.indexOf('"finish_reason":"stop"');
  expect(finishIdx).toBeGreaterThanOrEqual(0);
  expect(finishIdx).toBeLessThan(doneIdx);
});

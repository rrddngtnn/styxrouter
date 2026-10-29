import { expect, test } from "bun:test";
process.env.FETCH_BODY_TIMEOUT_MS = "120";
const { CodeBuddyCnExecutor } = await import("../open-sse/executors/codebuddy-cn");
const encoder = new TextEncoder();
const input = { model: "fixture", body: { messages: [] }, stream: true, credentials: { accessToken: "synthetic" } } as any;
const responseOf = (result: any): Response => result instanceof Response ? result : result.response;

test("disconnect cancels a stalled inspected JSON body promptly", async () => {
  const old = globalThis.fetch;
  const abort = new AbortController();
  let canceled: unknown;
  try {
    globalThis.fetch = (async () => new Response(new ReadableStream({
      start(c) { c.enqueue(encoder.encode('{"partial":')); },
      cancel(reason) { canceled = reason; },
    }), { headers: { "content-type": "application/json" } })) as typeof fetch;
    const promise = new CodeBuddyCnExecutor().execute({ ...input, signal: abort.signal });
    setTimeout(() => abort.abort(new Error("client disconnected")), 20);
    await expect(promise).rejects.toThrow("client disconnected");
    expect((canceled as Error)?.message).toBe("client disconnected");
  } finally { globalThis.fetch = old; }
});

test("oversized JSON streams through unchanged and cancellation reaches upstream", async () => {
  const old = globalThis.fetch;
  let canceled = false;
  const prefix = encoder.encode("x".repeat(65537));
  try {
    globalThis.fetch = (async () => new Response(new ReadableStream({
      start(c) { c.enqueue(prefix); },
      cancel() { canceled = true; },
    }), { headers: { "content-type": "application/json" } })) as typeof fetch;
    const response = responseOf(await new CodeBuddyCnExecutor().execute(input));
    const reader = response.body!.getReader();
    expect((await reader.read()).value).toEqual(prefix);
    await reader.cancel();
    expect(canceled).toBe(true);
  } finally { globalThis.fetch = old; }
});

test("SSE is returned without inspecting or waiting for its first chunk", async () => {
  const old = globalThis.fetch;
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  try {
    globalThis.fetch = (async () => new Response(new ReadableStream({ start(c) { controller = c; } }), { headers: { "content-type": "text/event-stream" } })) as typeof fetch;
    const result = await Promise.race([new CodeBuddyCnExecutor().execute(input), new Promise(resolve => setTimeout(() => resolve(null), 80))]);
    expect(result).not.toBeNull();
    controller.enqueue(encoder.encode("data: hello\n\n")); controller.close();
    expect(await responseOf(result).text()).toBe("data: hello\n\n");
  } finally { globalThis.fetch = old; }
});

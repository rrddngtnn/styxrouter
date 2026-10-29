import { expect, test } from "bun:test";
process.env.FETCH_BODY_TIMEOUT_MS = "120";
const { CodeBuddyCnExecutor } = await import("../open-sse/executors/codebuddy-cn");
const { FETCH_BODY_TIMEOUT_MS } = await import("../open-sse/config/constants");

test("stalled JSON hits configured total body deadline and cancels without awaiting cancellation", async () => {
  expect(FETCH_BODY_TIMEOUT_MS).toBe(120);
  const old = globalThis.fetch;
  let canceled: unknown;
  const body = new ReadableStream<Uint8Array>({
    start(c) { c.enqueue(new TextEncoder().encode('{"partial":')); },
    cancel(reason) { canceled = reason; return new Promise(() => {}); },
  });
  try {
    globalThis.fetch = (async () => new Response(body, { headers: { "content-type": "application/json" } })) as typeof fetch;
    const start = Date.now();
    const outcome = await Promise.race([
      new CodeBuddyCnExecutor().execute({ model: "fixture", body: { messages: [] }, stream: false, credentials: { accessToken: "synthetic" } } as any).then(() => "returned", e => e.name),
      new Promise(resolve => setTimeout(() => resolve("stalled"), 1000)),
    ]);
    expect(outcome).toBe("BodyTimeoutError");
    expect(Date.now() - start).toBeGreaterThanOrEqual(100);
    expect((canceled as Error)?.name).toBe("BodyTimeoutError");
  } finally { globalThis.fetch = old; }
});

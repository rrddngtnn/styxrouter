import { expect, test } from "bun:test";
import { CodeBuddyCnExecutor } from "../open-sse/executors/codebuddy-cn";

async function execute(response: Response) {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = (async () => response) as typeof fetch;
    const result: any = await new CodeBuddyCnExecutor().execute({ model: "fixture", body: { messages: [] }, stream: true, credentials: { accessToken: "fixture-secret" } } as any);
    return result instanceof Response ? result : result.response;
  } finally { globalThis.fetch = original; }
}

test("normalized response preserves upstream metadata without stale body headers or upstream text", async () => {
  const response = await execute(new Response('{"code":6004,"msg":"fixture-secret"}', { headers: { "content-type": "application/json", "content-length": "36", "content-encoding": "gzip", "retry-after": "120", "x-request-id": "fixture-id" } }));
  expect(response.status).toBe(429);
  expect(response.headers.get("x-request-id")).toBe("fixture-id");
  expect(response.headers.get("retry-after")).toBe("120");
  expect(response.headers.has("content-length")).toBe(false);
  expect(response.headers.has("content-encoding")).toBe(false);
  expect(await response.text()).not.toContain("fixture-secret");
});

test("partial JSON completing after 250ms is inspected and preserved", async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(c) { controller = c; c.enqueue(new TextEncoder().encode('{"partial":')); } });
  const pending = execute(new Response(body, { headers: { "content-type": "application/json" } }));
  await new Promise(resolve => setTimeout(resolve, 300));
  controller.enqueue(new TextEncoder().encode('true}'));
  controller.close();
  expect(await (await pending).text()).toBe('{"partial":true}');
});

test("client abort cancels a stalled inspection", async () => {
  const old = globalThis.fetch;
  const abort = new AbortController();
  let canceled = false;
  const body = new ReadableStream<Uint8Array>({ cancel() { canceled = true; } });
  try {
    globalThis.fetch = (async () => new Response(body, { headers: { "content-type": "application/json" } })) as typeof fetch;
    const pending = new CodeBuddyCnExecutor().execute({ model: "fixture", body: { messages: [] }, stream: true, credentials: { accessToken: "synthetic" }, signal: abort.signal } as any);
    await new Promise(resolve => setTimeout(resolve, 30));
    abort.abort();
    const outcome = await Promise.race([pending.then(() => "returned", (e) => e.name), new Promise(resolve => setTimeout(() => resolve("stalled"), 250))]);
    expect(outcome).toBe("AbortError");
    expect(canceled).toBe(true);
  } finally { globalThis.fetch = old; }
});

test("over 64KiB returns promptly and replays bytes then cancels upstream", async () => {
  let canceled = false;
  const first = new TextEncoder().encode("x".repeat(65537));
  const response = await Promise.race([
    execute(new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(first); }, cancel() { canceled = true; } }), { headers: { "content-type": "application/json" } })),
    new Promise<null>(resolve => setTimeout(() => resolve(null), 250)),
  ]);
  expect(response).not.toBeNull();
  const reader = response!.body!.getReader();
  expect((await reader.read()).value).toEqual(first);
  await reader.cancel();
  expect(canceled).toBe(true);
});

test("large JSON is passed through intact", async () => {
  const body = JSON.stringify({ code: 6000, payload: "x".repeat(70000) });
  const response = await execute(new Response(body, { headers: { "content-type": "application/json" } }));
  expect(response.status).toBe(200);
  expect(await response.text()).toBe(body);
});

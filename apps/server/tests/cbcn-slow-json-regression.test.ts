import "./helpers/test-secrets";
import { expect, test } from "bun:test";
import { CodeBuddyCnExecutor } from "../open-sse/executors/codebuddy-cn";
import { createApiKey, getApiKeyMetadata } from "../src/lib/db/apiKeys";
import { createProviderConnection, updateProviderConnection } from "../src/lib/db/providers";
import { initTranslators } from "../open-sse/translator/index";
import { handleChat } from "../src/sse/handlers/chat";

const encoder = new TextEncoder();
function delayed(body: string, contentType = "application/json"): Response {
  return new Response(new ReadableStream({ start(controller) {
    setTimeout(() => { controller.enqueue(encoder.encode(body)); controller.close(); }, 180);
  }}), { headers: { "content-type": contentType, "retry-after": "120" } });
}

test("delayed JSON semantic envelopes normalize for both request modes", async () => {
  const old = globalThis.fetch;
  try {
    for (const stream of [true, false]) {
      globalThis.fetch = (async () => delayed('{"code":6004}')) as typeof fetch;
      const result: any = await new CodeBuddyCnExecutor().execute({ model: "fixture", body: { messages: [] }, stream, credentials: { accessToken: "synthetic" } } as any);
      const response = result instanceof Response ? result : result.response;
      expect(response.status).toBe(429);
      expect(response.headers.get("retry-after")).toBe("120");
    }
  } finally { globalThis.fetch = old; }
});


test("delayed normal JSON passes and SSE returns before first chunk", async () => {
  const old = globalThis.fetch;
  try {
    for (const stream of [true, false]) {
      globalThis.fetch = (async () => delayed('{"code":6000,"value":"ok"}')) as typeof fetch;
      let result: any = await new CodeBuddyCnExecutor().execute({ model: "fixture", body: { messages: [] }, stream, credentials: { accessToken: "synthetic" } } as any);
      let response = result instanceof Response ? result : result.response;
      expect(await response.text()).toBe('{"code":6000,"value":"ok"}');
      globalThis.fetch = (async () => delayed('data: ok\n\n', 'text/event-stream')) as typeof fetch;
      result = await Promise.race([new CodeBuddyCnExecutor().execute({ model: "fixture", body: { messages: [] }, stream, credentials: { accessToken: "synthetic" } } as any), new Promise(resolve => setTimeout(() => resolve(null), 100))]);
      expect(result).not.toBeNull();
      response = result instanceof Response ? result : result.response;
      expect(await response.text()).toBe('data: ok\n\n');
    }
  } finally { globalThis.fetch = old; }
});

test("routes rotate on delayed 6004 for streaming and nonstreaming clients", async () => {
  await initTranslators();
  const old = globalThis.fetch;
  // An eligible sibling must not satisfy a request belonging to a different fixture.
  const connectionIds: string[] = [];
  const sibling = await createProviderConnection({ provider: "codebuddy-cn", authType: "oauth", accessToken: "synthetic-unrelated", isActive: true, priority: 1 });
  connectionIds.push(sibling.id);
  const event = 'data: {"id":"test","object":"chat.completion.chunk","created":1,"model":"deepseek-v3.2","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":null}]}\n\ndata: {"id":"test","object":"chat.completion.chunk","created":1,"model":"deepseek-v3.2","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
  try {
    for (const stream of [true, false]) {
      const first = `synthetic-first-${stream}`;
      const second = `synthetic-second-${stream}`;
      const firstConnection = await createProviderConnection({ provider: "codebuddy-cn", authType: "oauth", accessToken: first, isActive: true, priority: 10 } as any);
      const secondConnection = await createProviderConnection({ provider: "codebuddy-cn", authType: "oauth", accessToken: second, isActive: true, priority: 20 } as any);
      connectionIds.push(firstConnection.id, secondConnection.id);
      // Account priorities only order the eligible pool. Scope the key before
      // affinity/LRU selection so sibling fixtures cannot bypass the 6004 path.
      const allowedConnections = [firstConnection.id, secondConnection.id];
      const key = await createApiKey(`slow-semantic-${stream}`, "test", [], { allowedConnections });
      expect((await getApiKeyMetadata(key.key))?.allowedConnections).toEqual(allowedConnections);
      const seen: string[] = [];
      globalThis.fetch = (async (_url, init) => {
        const auth = new Headers(init?.headers).get("authorization") ?? "";
        seen.push(auth);
        if (auth === `Bearer ${first}`) return delayed('{"code":6004}');
        if (auth === `Bearer ${second}`) return new Response(event, { headers: { "content-type": "text/event-stream" } });
        throw new Error(`Unexpected fixture account: ${auth}`);
      }) as typeof fetch;
      const response = await handleChat(new Request("http://localhost/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key.key}` }, body: JSON.stringify({ model: "codebuddy-cn/deepseek-v3.2", messages: [{ role: "user", content: "hi" }], stream }) }));
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("ok");
      expect(seen).toEqual([`Bearer ${first}`, `Bearer ${second}`]);
      expect(seen).toContain(`Bearer ${first}`);
      expect(seen).toContain(`Bearer ${second}`);
      // Keep prior-mode siblings active until final cleanup: the next key's
      // selection scope, not deactivation timing, must isolate its failover.
    }
  } finally {
    globalThis.fetch = old;
    for (const id of connectionIds) await updateProviderConnection(id, { isActive: false });
  }
}, 60000);

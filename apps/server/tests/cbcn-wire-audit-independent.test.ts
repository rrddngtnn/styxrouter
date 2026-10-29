import { test, expect } from "bun:test";
import { CodeBuddyCnExecutor } from "../open-sse/executors/codebuddy-cn";

test("audit CN outbound conversation IDs across two synthetic requests", async () => {
  const original = globalThis.fetch;
  const captured: Headers[] = [];
  globalThis.fetch = (async (_url, init) => {
    captured.push(new Headers(init?.headers));
    return new Response('data: [DONE]\n\n', {headers: {'content-type': 'text/event-stream'}});
  }) as typeof fetch;
  try {
    const executor = new CodeBuddyCnExecutor();
    for (let i = 0; i < 2; i++) {
      const result = await executor.execute({model: 'fixture', body: {model: 'fixture', messages: [{role: 'user', content: 'hi'}]}, stream: true, credentials: {accessToken: 'synthetic-token'}, clientHeaders: {'x-conversation-id': 'fixture-conversation'}} as any);
      expect((result as any).response.status).toBe(200);
    }
    expect(captured).toHaveLength(2);
    console.log('SYNTHETIC_WIRE', JSON.stringify(captured.map(h => ({conversation:h.get('x-conversation-id'), request:h.get('x-conversation-request-id'), message:h.get('x-conversation-message-id'), userAgent:h.get('user-agent'), ideType:h.get('x-ide-type'), ideName:h.get('x-ide-name'), device:h.get('x-device-id'), user:h.get('x-user-id')}))));
    expect(captured[0].get('x-conversation-id')).not.toBe('fixture-conversation');
    expect(captured[0].get('x-conversation-id')).not.toBe(captured[1].get('x-conversation-id'));
  } finally { globalThis.fetch = original; }
});

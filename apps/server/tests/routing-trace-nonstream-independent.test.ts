import "./helpers/test-secrets";
import { expect, test } from "bun:test";
import { createApiKey } from "../src/lib/db/apiKeys";
import { createProviderConnection } from "../src/lib/db/providers";
import { replaceSyncedAvailableModelsForConnection } from "../src/lib/db/models";
import { initTranslators } from "../open-sse/translator/index";
import { handleChat } from "../src/sse/handlers/chat";

import { clearRoutingTrace, readRoutingTrace } from "../src/sse/services/routingDecisionTrace";

const sse = 'data: {"type":"response.completed","response":{"id":"resp_test","object":"response","status":"completed","model":"fixture","output":[{"type":"message","id":"msg_test","role":"assistant","status":"completed","content":[{"type":"output_text","text":"ok","annotations":[]}]}],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}\n\ndata: [DONE]\n\n';

test("two overlapping nonstream requests correlate selections and 429 retries independently", async () => {
  clearRoutingTrace();
  await initTranslators();
  const a = await createProviderConnection({ provider: "codex", authType: "oauth", accessToken: "correlation-token-a", isActive: true, priority: 1 } as any);
  const b = await createProviderConnection({ provider: "codex", authType: "oauth", accessToken: "correlation-token-b", isActive: true, priority: 2 } as any);
  const c = await createProviderConnection({ provider: "codex", authType: "oauth", accessToken: "correlation-token-c", isActive: true, priority: 3 } as any);
  const d = await createProviderConnection({ provider: "codex", authType: "oauth", accessToken: "correlation-token-d", isActive: true, priority: 4 } as any);
  for (const conn of [a, b, c, d]) await replaceSyncedAvailableModelsForConnection("codex", conn.id, [{ id: "gpt-5.5", name: "fixture" }]);
  const key = await createApiKey("correlation-test", "test");
  let arrivals = 0;
  const failedAccounts = new Set<string>();
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = (async (url, options) => {
      if (!String(url).startsWith("https://chatgpt.com/backend-api/codex/")) throw new Error("Unexpected outbound request blocked");
      const auth = new Headers(options?.headers).get("authorization");
      if (arrivals < 2) {
        failedAccounts.add(auth ?? "");
        if (++arrivals === 2) release();
        await barrier;
        return new Response('{"error":{"message":"rate limited"}}', { status: 429, headers: { "content-type": "application/json", "retry-after": "1" } });
      }
      if (!auth?.startsWith("Bearer correlation-token-")) throw new Error("Unexpected credential");
      if (failedAccounts.has(auth)) return new Response('{"error":{"message":"rate limited"}}', { status: 429, headers: { "content-type": "application/json", "retry-after": "1" } });
      return new Response(sse, { headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;
    const request = (n: number) => new Request("http://localhost/v1/responses", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key.key}`, "x-session-id": `correlation-session-${n}`, "x-request-id": "caller-controlled-secret" }, body: JSON.stringify({ model: "codex/gpt-5.5", input: `private-prompt-${n}`, stream: false }) });
    const results = await Promise.all([handleChat(request(1)), handleChat(request(2))]);
    expect(await Promise.all(results.map(async r => [r.status, await r.text()]))).toEqual([[200, expect.stringContaining("ok")], [200, expect.stringContaining("ok")]]);
    expect(arrivals).toBe(2);
    const events = readRoutingTrace() as Array<any>;
    const groups = new Map<string, any[]>();
    for (const event of events) {
      expect(event.requestId).toMatch(/^[a-f0-9]{32}$/);
      groups.set(event.requestId, [...(groups.get(event.requestId) ?? []), event]);
    }
    expect(groups.size).toBe(2);
    for (const group of groups.values()) {
      const reasons = group.map(e => e.reason);
      const outcome = reasons.indexOf("routing429");
      expect(outcome).toBeGreaterThan(0);
      expect(reasons.slice(0, outcome)).toContain("selected");
      expect(reasons.slice(outcome + 1)).toContain("selected");
    }
    const serialized = JSON.stringify(events);
    for (const secret of ["correlation-token", "private-prompt", "caller-controlled-secret", key.key]) expect(serialized).not.toContain(secret);
  } finally { globalThis.fetch = previous; clearRoutingTrace(); }
}, 60000);

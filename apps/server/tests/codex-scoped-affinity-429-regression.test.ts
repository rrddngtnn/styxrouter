import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createApiKey } from "../src/lib/db/apiKeys";
import { createProviderConnection } from "../src/lib/db/providers";
import { replaceSyncedAvailableModelsForConnection } from "../src/lib/db/models";
import { getSessionAccountAffinity, upsertSessionAccountAffinity } from "../src/lib/db/sessionAccountAffinity";
import { extractSessionAffinityKey, getProviderCredentials } from "../src/sse/services/auth";
import { initTranslators } from "../open-sse/translator/index";
import { handleChat } from "../src/sse/handlers/chat";
import { clearRoutingTrace, readRoutingTrace } from "../src/sse/services/routingDecisionTrace";

const ttl = 1_800_000;
const sse = 'data: {"type":"response.completed","response":{"id":"resp_test","object":"response","status":"completed","model":"fixture","output":[{"type":"message","id":"msg_test","role":"assistant","status":"completed","content":[{"type":"output_text","text":"ok","annotations":[]}]}],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}\n\ndata: [DONE]\n\n';

test("routed Codex 429 evicts only the failing key-scoped pin and rotates accounts", async () => {
  clearRoutingTrace();
  await initTranslators();
  const a = await createProviderConnection({ provider: "codex", authType: "oauth", accessToken: "synthetic-token-a", isActive: true, priority: 2 } as any);
  const b = await createProviderConnection({ provider: "codex", authType: "oauth", accessToken: "synthetic-token-b", isActive: true, priority: 1 } as any);
  for (const conn of [a, b]) await replaceSyncedAvailableModelsForConnection("codex", conn.id, [{ id: "gpt-5.5", name: "fixture" }]);
  const keyA = await createApiKey("affinity-429-a", "test");
  const keyB = await createApiKey("affinity-429-b", "test");
  const session = extractSessionAffinityKey({}, new Headers({ "x-session-id": "fixture-session" }))!;
  const scope = (id: string) => `affinity-v1:${createHash("sha256").update(JSON.stringify([id, session])).digest("hex")}`;
  const scopedA = scope(keyA.id);
  const scopedB = scope(keyB.id);
  upsertSessionAccountAffinity(scopedA, "codex", a.id, Date.now(), ttl);
  upsertSessionAccountAffinity(scopedB, "codex", a.id, Date.now(), ttl);
  const legacy = JSON.stringify([keyA.id, session]);
  upsertSessionAccountAffinity(legacy, "codex", b.id, Date.now(), ttl);
  const seen: string[] = [];
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = (async (url, options) => {
      if (!String(url).startsWith("https://chatgpt.com/backend-api/codex/")) throw new Error("Unexpected outbound request blocked");
      const auth = new Headers(options?.headers).get("authorization") ?? "";
      seen.push(auth);
      return auth === "Bearer synthetic-token-a"
        ? new Response('{"error":{"message":"rate limited"}}', { status: 429, headers: { "content-type": "application/json", "retry-after": "1" } })
        : new Response(sse, { headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;
    const request = new Request("http://localhost/v1/responses", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${keyA.key}`, "x-session-id": "fixture-session" }, body: JSON.stringify({ model: "codex/gpt-5.5", input: "hi", stream: true }) });
    const result = await handleChat(request);
    const text = await result.text();
    expect(result.status).toBe(200);
    expect(readRoutingTrace().some(event => event.reason === "routing429" && event.cooldownMs !== undefined)).toBe(true);
    expect(JSON.stringify(readRoutingTrace())).not.toContain("synthetic-token");
    expect(text).toContain("response.completed");
    expect(seen[0]).toBe("Bearer synthetic-token-a");
    expect(seen.at(-1)).toBe("Bearer synthetic-token-b");
    expect(new Set(seen)).toEqual(new Set(["Bearer synthetic-token-a", "Bearer synthetic-token-b"]));
    expect(getSessionAccountAffinity(scopedA, "codex", ttl)).toBeNull();
    expect(getSessionAccountAffinity(scopedB, "codex", ttl)?.connectionId).toBe(a.id);
    expect(getSessionAccountAffinity(legacy, "codex", ttl)?.connectionId).toBe(b.id);
  } finally { globalThis.fetch = previous; }
}, 60000);

test("request TTL zero does not read or alter an existing pin", async () => {
  const a = await createProviderConnection({ provider: "openai", authType: "apikey", apiKey: "synthetic-zero-a", isActive: true, priority: 1 } as any);
  const b = await createProviderConnection({ provider: "openai", authType: "apikey", apiKey: "synthetic-zero-b", isActive: true, priority: 2 } as any);
  const key = "request-zero-session";
  upsertSessionAccountAffinity(key, "openai", b.id, Date.now(), ttl);
  const selected = await getProviderCredentials("openai", null, [a.id, b.id], null, { sessionKey: key, sessionAffinityTtlMs: 0 });
  expect(selected?.connectionId).toBe(a.id);
  expect(getSessionAccountAffinity(key, "openai", ttl)?.connectionId).toBe(b.id);
}, 60000);

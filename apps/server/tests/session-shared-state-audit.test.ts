import { expect, test } from "bun:test";
import { createApiKey } from "../src/lib/db/apiKeys";
import { createProviderNode, createProviderConnection } from "../src/lib/db/providers";
import { createCombo } from "../src/lib/db/combos";
import { upsertHandoff, getHandoff, recordSessionModelUsage, getLastSessionModel } from "../src/lib/db/contextHandoffs";
import { clearSessions, getActiveSessions, touchSession, getSessionConnection, markToolFinish, consumeToolFinishTime } from "../open-sse/services/sessionManager";
import { initTranslators } from "../open-sse/translator/index";
import { handleChat } from "../src/sse/handlers/chat";

test("authenticated chat isolates handoffs, model history, metadata and tool timing across keys", async () => {
  clearSessions();
  await initTranslators();
  const node: any = await createProviderNode({ type: "openai-compatible", name: "auditfixture", prefix: "auditfixture", apiType: "chat", baseUrl: "https://auditfixture.example/v1" });
  await createProviderConnection({ provider: node.id, authType: "apikey", apiKey: "synthetic-upstream" } as any);
  await createCombo({ name: "audit-combo", strategy: "context-relay", models: ["auditfixture/fixture"] } as any);
  const a = await createApiKey("audit-a", "test");
  const b = await createApiKey("audit-b", "test");
  const bodies: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any, options: any) => {
    if (String(url).startsWith("http://127.0.0.1:")) return originalFetch(url, options);
    bodies.push(String(options.body));
    return Response.json({ id: "fixture", object: "chat.completion", model: "fixture", choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
  }) as typeof fetch;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handleChat });
  const request = async (key: string) => {
    const response = await originalFetch(`http://127.0.0.1:${server.port}/v1/chat/completions`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}`, "x-session-id": "audit-shared-id" },
      body: JSON.stringify({ model: "audit-combo", stream: false, messages: [{ role: "user", content: "hello" }] }),
    });
    expect(response.status).toBe(200);
    await response.text();
  };
  try {
    await request(a.key);
    expect(getActiveSessions()).toHaveLength(1);
    const sessionA = getActiveSessions()[0].sessionId;
    const now = new Date().toISOString();
    upsertHandoff({ sessionId: sessionA, comboName: "audit-combo", fromAccount: "other-account", summary: "SYNTHETIC-PRIVATE-SUMMARY-A", keyDecisions: [], taskProgress: "", activeEntities: [], messageCount: 1, model: "model-a", warningThresholdPct: 0.85, generatedAt: now, expiresAt: "2999-01-01T00:00:00.000Z" });
    recordSessionModelUsage(sessionA, "audit-combo", "model-a", "provider-a");
    touchSession(sessionA, "account-a");
    markToolFinish(sessionA);

    await request(b.key);
    const sessions = getActiveSessions();
    expect(sessions).toHaveLength(2);
    const sessionB = sessions.find((session) => session.sessionId !== sessionA)!.sessionId;
    expect(getHandoff(sessionB, "audit-combo")).toBeNull();
    expect(getLastSessionModel(sessionB, "audit-combo")).not.toBe("model-a");
    expect(bodies.at(-1)).not.toContain("SYNTHETIC-PRIVATE-SUMMARY-A");
    expect(getSessionConnection(sessionB)).not.toBe("account-a");
    expect(consumeToolFinishTime(sessionB)).toBeNull();
    expect(consumeToolFinishTime(sessionA)).not.toBeNull();
    expect(consumeToolFinishTime(sessionA)).toBeNull();
    expect(getHandoff(sessionA, "audit-combo")?.summary).toBe("SYNTHETIC-PRIVATE-SUMMARY-A");
    expect(getLastSessionModel(sessionA, "audit-combo")).toBe("model-a");
    await request(a.key);
    expect(bodies.at(-1)).toContain("SYNTHETIC-PRIVATE-SUMMARY-A");
    expect(getActiveSessions()).toHaveLength(2);
  } finally {
    server.stop(true);
    globalThis.fetch = originalFetch;
    clearSessions();
  }
}, 60000);

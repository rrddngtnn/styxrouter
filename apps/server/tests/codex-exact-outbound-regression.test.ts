import { expect, test } from "bun:test";

const { createProviderConnection } = await import("../src/lib/db/providers.ts");
const { replaceSyncedAvailableModelsForConnection } = await import("../src/lib/db/models.ts");
const { getProviderCredentials } = await import("../src/sse/services/auth.ts");
const { getModelInfo } = await import("../src/sse/services/model.ts");
const { CodexExecutor, __setCodexWebSocketTransportForTesting } = await import("../open-sse/executors/codex.ts");
const { checkAndRefreshToken } = await import("../src/sse/services/tokenRefresh.ts");
const { resolveExecutionCredentials } = await import("../open-sse/handlers/chatCore/executionCredentials.ts");
const { handleChat } = await import("../src/sse/handlers/chat.ts");
const { initTranslators } = await import("../open-sse/translator/index.ts");

test("exact active Codex ID wins over an effort alias across selection and actual outbound dispatch", async () => {
  const base = await createProviderConnection({ provider: "codex", name: "base-only", authType: "oauth", accessToken: "base-token", isActive: true, priority: 1 } as any);
  const exact = await createProviderConnection({ provider: "codex", name: "exact", authType: "oauth", accessToken: "exact-token", isActive: true, priority: 2 } as any);
  await replaceSyncedAvailableModelsForConnection("codex", base.id, [{ id: "gpt-5.5", name: "Base" }]);
  await replaceSyncedAvailableModelsForConnection("codex", exact.id, [{ id: "gpt-5.5-high", name: "Exact" }]);
  const info = await getModelInfo("codex/gpt-5.5-high");
  expect(info.model).toBe("gpt-5.5-high");
  const selected = await getProviderCredentials("codex", null, [base.id, exact.id], info.model);
  expect(selected?.connectionId).toBe(exact.id);
  const exactOnly = await getProviderCredentials("codex", null, [exact.id], info.model);
  expect(exactOnly?.connectionId).toBe(exact.id);
  const deniedBase = await getProviderCredentials("codex", null, [base.id], info.model);
  expect(deniedBase?.connectionId).toBeUndefined();
  let sent: any;
  let sentAuthorization = "";
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = (async (_url, options) => {
      sent = JSON.parse(String(options?.body));
      sentAuthorization = new Headers(options?.headers).get("authorization") ?? "";
      return new Response('data: {"type":"response.output_text.delta","delta":"ok","output_index":0,"content_index":0}\n\ndata: {"type":"response.completed","response":{"id":"resp_test","object":"response","status":"completed","model":"fixture","output":[{"type":"message","id":"msg_test","role":"assistant","status":"completed","content":[{"type":"output_text","text":"ok","annotations":[]}]}],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;
    const refreshed = await checkAndRefreshToken("codex", selected);
    const execution = resolveExecutionCredentials({ credentials: refreshed, nativeCodexPassthrough: true, endpointPath: "/v1/responses", targetFormat: "openai-responses", provider: "codex", ccSessionId: null });
    const result = await new CodexExecutor().execute({ model: info.model, body: { model: info.model, input: "hi", reasoning: { effort: "low" } }, stream: true, credentials: execution as any });
    expect((result as any).response.status).toBe(200);
    expect(sent.model).toBe("gpt-5.5-high");
    expect(sent.reasoning.effort).toBe("low");

    await initTranslators();
    const client = new Request("http://localhost/v1/responses", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "codex/gpt-5.5-high", input: "hi", stream: true, reasoning: { effort: "low" } }) });
    sent = undefined;
    const routed = await handleChat(client);
    expect(routed.status).toBe(200);
    expect(await routed.text()).toContain("response.completed");
    expect(sentAuthorization).toBe("Bearer exact-token");
    expect(sent.model).toBe("gpt-5.5-high");
    expect(sent.reasoning.effort).toBe("low");

    let wsBody: any;
    const socket: any = {
      send(payload: string) {
        wsBody = JSON.parse(payload);
        queueMicrotask(() => socket.onmessage({ data: JSON.stringify({ type: "response.completed", response: { status: "completed" } }) }));
      },
      close() {},
    };
    __setCodexWebSocketTransportForTesting((async () => socket) as any);
    const wsResult = await new CodexExecutor().execute({ model: info.model, body: { model: info.model, input: "hi", reasoning: { effort: "low" } }, stream: true, credentials: { ...execution, providerSpecificData: { ...execution.providerSpecificData, codexTransport: "websocket" } } as any });
    await (wsResult as any).response.text();
    expect(wsBody.model).toBe("gpt-5.5-high");
    expect(wsBody.reasoning.effort).toBe("low");

    const alias = await getModelInfo("codex/gpt-5.5-low");
    const aliasAccount = await getProviderCredentials("codex", null, [base.id, exact.id], alias.model);
    expect(aliasAccount?.connectionId).toBe(base.id);
    const rotated = Object.assign({}, selected, aliasAccount);
    expect(rotated.codexExactModel).toBeUndefined();
    const aliasResult = await new CodexExecutor().execute({ model: alias.model, body: { model: alias.model, input: "hi", reasoning: { effort: "high" } }, stream: true, credentials: aliasAccount as any });
    expect((aliasResult as any).response.status).toBe(200);
    expect(sent.model).toBe("gpt-5.5");
    expect(sent.reasoning.effort).toBe("low");
  } finally {
    globalThis.fetch = previous;
    __setCodexWebSocketTransportForTesting(undefined);
  }
});

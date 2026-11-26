import "./helpers/test-secrets";
import { expect, test } from "bun:test";
import { AntigravityExecutor } from "../open-sse/executors/antigravity.ts";
import {
  buildGeminiThoughtSignatureKey,
  GEMINI_SIGNATURELESS_TOOL_CALL,
  getAntigravityThoughtSignatureNamespace,
  storeGeminiThoughtSignature,
} from "../open-sse/services/geminiThoughtSignatureStore.ts";

test("only replays a signature for its original wire model, account, session and tool call", async () => {
  const { createProviderConnection } = await import("../src/lib/db/providers.ts");
  const { createApiKey } = await import("../src/lib/db/apiKeys.ts");
  const { setMitmAliasAll } = await import("../src/lib/db/models/mitmAlias.ts");
  const connection = await createProviderConnection({
    provider: "antigravity", authType: "oauth", accessToken: "synthetic-access",
    projectId: "synthetic-project", isActive: true, name: "signature-fixture", priority: 1,
  } as Parameters<typeof createProviderConnection>[0]);
  const key = await createApiKey("signature-fixture", "test");
  await setMitmAliasAll("antigravity", {
    "fixture-a": "antigravity/gemini-4-fixture-a",
    "fixture-b": "antigravity/gemini-4-fixture-b",
    "fixture-same-wire": "antigravity/gemini-4-fixture-a",
  });
  const signedCallId = "fixture-signed-call";
  const otherCallId = "fixture-unsigned-call";
  const signature = "synthetic-signature-from-a";
  // Old cache rows were keyed only by connection and tool ID.
  storeGeminiThoughtSignature(buildGeminiThoughtSignatureKey(connection.id, otherCallId), "legacy-signature");
  const upstream: Array<{ model: string; request: { contents: Array<{ parts: Array<{
    functionCall?: { id: string }; functionResponse?: { id: string }; thoughtSignature?: string;
  }> }> } }> = [];
  const user = { role: "user", content: "Use the fixture tool." };
  const tools = [{ type: "function", function: { name: "lookup", parameters: { type: "object" } } }];
  const history = [user, { role: "assistant", content: null, tool_calls: [otherCallId, signedCallId].map((id) => ({
    id, type: "function", function: { name: "lookup", arguments: "{}" },
  })) }, ...[otherCallId, signedCallId].map((id) => ({ role: "tool", tool_call_id: id, content: "fixture result" }))];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url, init) => {
    if (String(url).includes("auto-updater")) return Response.json([{ version: "1.0.0" }]);
    if (!String(url).includes(":streamGenerateContent")) throw new Error("Unexpected fixture request");
    const payload = JSON.parse(await new Response(init?.body as BodyInit).text()) as (typeof upstream)[number];
    upstream.push(payload);
    const parts = upstream.length === 1
      ? [{ functionCall: { id: signedCallId, name: "lookup", args: {} }, thoughtSignature: signature }]
      : [{ text: "OK" }];
    const chunk = { response: { candidates: [{ content: { parts }, finishReason: "STOP" }] } };
    return new Response(`data: ${JSON.stringify(chunk)}\n\n`, { headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch;

  try {
    const { handleChat } = await import("../src/sse/handlers/chat.ts");
    const chat = async (model: string, messages: unknown[], session = "fixture-session") => {
      const response = await handleChat(new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key.key}`, "x-styx-session-id": session },
        body: JSON.stringify({ model: `antigravity/${model}`, messages, tools, stream: true }),
      }));
      expect(response.status).toBe(200);
      return response.text();
    };
    expect(await chat("fixture-a", [user])).toContain(signedCallId);
    await chat("fixture-a", history);
    await chat("fixture-b", history);
    await chat("fixture-a", history, "other-session");
    await chat("fixture-same-wire", history);

    const calls = (index: number) => upstream[index].request.contents.flatMap(({ parts }) => parts)
      .filter((part) => part.functionCall)
      .map((part) => [part.functionCall?.id, part.thoughtSignature]);
    const unsigned = [otherCallId, GEMINI_SIGNATURELESS_TOOL_CALL];
    const sameScope = [unsigned, [signedCallId, signature]];
    const differentScope = [unsigned, [signedCallId, GEMINI_SIGNATURELESS_TOOL_CALL]];
    expect(calls(1)).toEqual(sameScope);
    expect(calls(2)).toEqual(differentScope);
    expect(calls(3)).toEqual(differentScope);
    expect(calls(4)).toEqual(sameScope);
    expect(upstream[2].request.contents.flatMap(({ parts }) => parts)
      .flatMap((part) => part.functionResponse?.id ?? [])).toEqual([otherCallId, signedCallId]);
  } finally {
    globalThis.fetch = originalFetch;
    await setMitmAliasAll("antigravity", {});
  }
}, 30_000);

test("executor does not send a translated signature after retrying a different account or wire model", async () => {
  const executor = new AntigravityExecutor();
  const wireModel = "gemini-4-fixture-a";
  const sessionScope = "fixture-session";
  const replay = { namespace: getAntigravityThoughtSignatureNamespace("account-a", wireModel, sessionScope), sessionScope };
  const body = { request: { contents: [{ role: "model", parts: [
    { functionCall: { id: "call-fixture", name: "lookup" }, thoughtSignature: "synthetic-original" },
  ] }] } };
  const transform = async (account: string, model: string) => {
    const result = await executor.transformRequest(wireModel, body, true, {
      connectionId: account, projectId: "synthetic-project",
    }, model, undefined, replay);
    expect(result).not.toBeInstanceOf(Response);
    return JSON.stringify(result);
  };
  expect(await transform("account-a", wireModel)).toContain("synthetic-original");
  for (const [account, model] of [["account-b", wireModel], ["account-a", "gemini-4-fixture-b"]]) {
    const serialized = await transform(account, model);
    expect(serialized).not.toContain("synthetic-original");
    expect(serialized).toContain(GEMINI_SIGNATURELESS_TOOL_CALL);
  }
  expect(body.request.contents[0].parts[0].thoughtSignature).toBe("synthetic-original");
});

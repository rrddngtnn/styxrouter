import "./helpers/test-secrets";
import { expect, test } from "bun:test";

test.each([false, true])("HTTP 403 rotation preserves wire model (dynamic=%s)", async (dynamic) => {
  const requested = dynamic ? "synthetic-dynamic" : "gemini-4-argon";
  const target = dynamic ? "synthetic-wire" : "gemini-4-argon-medium";
  const first = dynamic ? "dynamic-first" : "first";
  const second = dynamic ? "dynamic-second" : "second";
  const { setMitmAliasAll } = await import("../src/lib/db/models/mitmAlias.ts");
  await setMitmAliasAll("antigravity", dynamic ? { [requested]: `antigravity/${target}` } : {});
  const { createProviderConnection } = await import("../src/lib/db/providers.ts");
  const { replaceSyncedAvailableModelsForConnection } = await import("../src/lib/db/models.ts");
  const { createApiKey } = await import("../src/lib/db/apiKeys.ts");
  const unknown = await createProviderConnection({ provider: "antigravity", authType: "oauth", accessToken: "synthetic-first", projectId: first, isActive: true, name: "unknown", priority: 1 } as any);
  const capable = await createProviderConnection({ provider: "antigravity", authType: "oauth", accessToken: "synthetic-second", projectId: second, isActive: true, name: "capable", priority: 2 } as any);
  await replaceSyncedAvailableModelsForConnection("antigravity", capable.id, [{ id: target, name: "medium" }]);
  const key = await createApiKey("alias-dispatch", "test");
  const wire: Array<{model: string; project: string}> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url, init) => {
    if (String(url).includes("auto-updater")) return Response.json([{ version: "1.0.0" }]);
    const payload = JSON.parse(await new Response(init?.body as BodyInit).text());
    if (String(url).includes(":streamGenerateContent") && (payload.project === first || payload.project === second)) wire.push({ model: payload.model, project: payload.project });
    if (payload.project === first) {
      if (dynamic) await setMitmAliasAll("antigravity", { [requested]: "antigravity/synthetic-mutated-wire" });
      return Response.json({ error: { message: "Permission denied" } }, { status: 403 });
    }
    return new Response('data: {"response":{"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}}\n\n', { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch;
  try {
    const { handleChat } = await import("../src/sse/handlers/chat.ts");
    const response = await handleChat(new Request("http://localhost/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key.key}` }, body: JSON.stringify({ model: `antigravity/${requested}`, messages: [{ role: "user", content: "hello" }], stream: true }) }));
    await response.text();
    expect(response.status).toBe(200);
    expect(wire.length).toBeGreaterThanOrEqual(2);
    expect(wire[0]).toEqual({ model: target, project: first });
    expect(wire.at(-1)).toEqual({ model: target, project: second });
    expect(wire.every((request) => request.model === target)).toBe(true);
  } finally { globalThis.fetch = original; await setMitmAliasAll("antigravity", {}); }
}, 30000);

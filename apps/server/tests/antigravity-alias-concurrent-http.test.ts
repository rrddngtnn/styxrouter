import "./helpers/test-secrets";
import { expect, test } from "bun:test";

test.each([false, true])("concurrent HTTP requests isolate frozen aliases and enforce wire ACL on retry (revoke=%s)", async (revoke) => {
  const { setMitmAliasAll } = await import("../src/lib/db/models/mitmAlias.ts");
  const { createProviderConnection, deleteProviderConnectionsByProvider } = await import("../src/lib/db/providers.ts");
  await deleteProviderConnectionsByProvider("antigravity");
  const { createApiKey, updateApiKeyPermissions } = await import("../src/lib/db/apiKeys.ts");
  const { handleChat } = await import("../src/sse/handlers/chat.ts");
  await setMitmAliasAll("antigravity", { "concurrent-alias": "antigravity/wire-first" });
  for (const [projectId, priority] of [["first", 1], ["second", 2]] as const) {
    await createProviderConnection({ provider: "antigravity", authType: "oauth", accessToken: "synthetic", projectId, priority, isActive: true } as any);
  }
  const key = await createApiKey("concurrent", "test");
  const otherKey = await createApiKey("concurrent-other", "test");
  await updateApiKeyPermissions(key.id, { blockedModels: ["antigravity/wire-blocked"] });
  await updateApiKeyPermissions(otherKey.id, { blockedModels: ["antigravity/wire-blocked"] });
  let release!: () => void;
  let arrived!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const firstArrival = new Promise<void>((resolve) => { arrived = resolve; });
  const wire: Array<{ model: string; project: string }> = [];
  const original = globalThis.fetch;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => handleChat(request) });
  globalThis.fetch = (async (url, init) => {
    if (String(url).startsWith(`http://127.0.0.1:${server.port}/`)) return original(url, init);
    if (String(url).includes("auto-updater")) return Response.json([{ version: "1.0.0" }]);
    if (!String(url).includes(":streamGenerateContent")) throw new Error(`Unexpected network request: ${url}`);
    const payload = JSON.parse(await new Response(init?.body as BodyInit).text());
    wire.push({ model: payload.model, project: payload.project });
    if (payload.project === "first") {
      arrived();
      await gate;
      return Response.json({ error: { message: "Permission denied" } }, { status: 403 });
    }
    return new Response('data: {"response":{"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}}\n\n', { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch;
  const send = (apiKey = key.key) => original(`http://127.0.0.1:${server.port}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model: "antigravity/concurrent-alias", messages: [{ role: "user", content: "hi" }], stream: true }) });
  try {
    const first = send();
    await firstArrival;
    await setMitmAliasAll("antigravity", { "concurrent-alias": "antigravity/wire-blocked" });
    const blocked = await send(otherKey.key);
    await blocked.text();
    expect(blocked.status).toBe(403);
    if (revoke) await updateApiKeyPermissions(key.id, { blockedModels: ["antigravity/wire-blocked", "antigravity/wire-first"] });
    release();
    const response = await first;
    await response.text();
    expect(response.status).toBe(revoke ? 403 : 200);
    expect(wire[0]).toEqual({ model: "wire-first", project: "first" });
    if (!revoke) expect(wire.at(-1)).toEqual({ model: "wire-first", project: "second" });
    else expect(wire).toEqual([{ model: "wire-first", project: "first" }]);
    expect(wire.every((attempt) => attempt.model === "wire-first")).toBe(true);
  } finally {
    release();
    server.stop(true);
    globalThis.fetch = original;
  }
}, 30000);

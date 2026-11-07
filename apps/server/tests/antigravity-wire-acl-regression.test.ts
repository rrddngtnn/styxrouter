import "./helpers/test-secrets";
import { expect, test } from "bun:test";

test("authenticated requests enforce alias and wire ACLs and preserve pinned connections", async () => {
  const { setMitmAliasAll } = await import("../src/lib/db/models/mitmAlias.ts");
  const { createProviderConnection } = await import("../src/lib/db/providers.ts");
  const { createApiKey, updateApiKeyPermissions } = await import("../src/lib/db/apiKeys.ts");
  const { handleChat } = await import("../src/sse/handlers/chat.ts");
  await setMitmAliasAll("antigravity", { "acl-alias": "antigravity/acl-wire" });
  const connection = await createProviderConnection({ provider: "antigravity", authType: "oauth", accessToken: "synthetic", projectId: "synthetic", isActive: true } as any);
  const wire: string[] = [];
  let mutated = false;
  const old = globalThis.fetch;
  globalThis.fetch = (async (url, init) => {
    if (String(url).includes("auto-updater")) {
      await setMitmAliasAll("antigravity", { "acl-alias": "antigravity/blocked-after-check" });
      mutated = true;
      return Response.json([{ version: "1.0.0" }]);
    }
    if (String(url).includes(":streamGenerateContent")) wire.push(JSON.parse(await new Response(init?.body as BodyInit).text()).model);
    return new Response('data: {"response":{"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}}\n\n', { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch;
  try {
    async function send(permissions: any, model = "antigravity/acl-alias") {
      const key = await createApiKey(`acl-${crypto.randomUUID()}`, "test");
      await updateApiKeyPermissions(key.id, { ...permissions, allowedConnections: [connection.id] });
      const response = await handleChat(new Request("http://localhost/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key.key}` }, body: JSON.stringify({ model, messages: [{ role: "user", content: "hi" }], stream: true, antigravityWireModel: "acl-safe", antigravityResolvedFor: "acl-alias", _styxInternalRequest: "context-handoff" }) }));
      await response.text();
      return response.status;
    }
    expect(await send({ blockedModels: ["antigravity/acl-wire"] })).toBe(403);
    expect(await send({ blockedModels: ["antigravity/acl-alias"] })).toBe(403);
    expect(await send({ allowedModels: ["antigravity/acl-alias"] })).toBe(403);
    expect(await send({ allowedModels: ["antigravity/acl-alias", "antigravity/acl-wire"], blockedModels: ["antigravity/blocked-after-check"] })).toBe(200);
    expect(mutated).toBe(true);
    expect(wire).toEqual(["acl-wire"]);
  } finally { globalThis.fetch = old; }
}, 30000);

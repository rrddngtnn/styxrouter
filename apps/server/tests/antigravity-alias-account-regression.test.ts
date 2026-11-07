import "./helpers/test-secrets";
import { afterEach, expect, test } from "bun:test";
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

const { createProviderConnection } = await import("../src/lib/db/providers.ts");
const { replaceSyncedAvailableModelsForConnection } = await import("../src/lib/db/models.ts");
const { getProviderCredentials } = await import("../src/sse/services/auth.ts");

test("exact catalog IDs preserve embedded slash", async () => {
  const { resolveAntigravityWireModel } = await import("../open-sse/services/antigravityModelResolution.ts");
  expect(await resolveAntigravityWireModel("family/literal-id", true)).toBe("family/literal-id");
});

test("alias never selects an account excluding the resolved wire model", async () => {
  const { setMitmAliasAll } = await import("../src/lib/db/models/mitmAlias.ts");
  await setMitmAliasAll("antigravity", { "excluded-alias": "antigravity/excluded-wire" });
  const account = await createProviderConnection({ provider: "antigravity", authType: "oauth", accessToken: "synthetic-excluded", projectId: "excluded", isActive: true, providerSpecificData: { excludedModels: ["excluded-wire"] } } as any);
  const selected = await getProviderCredentials("antigravity", null, [account.id], "excluded-alias");
  expect(selected?.connectionId).not.toBe(account.id);
});

test("Argon alias selects an account whose catalog advertises its wire model", async () => {
  const account = await createProviderConnection({ provider: "antigravity", authType: "oauth", accessToken: "synthetic-argon", projectId: "fixture", isActive: true, name: "Argon fixture" } as any);
  await replaceSyncedAvailableModelsForConnection("antigravity", account.id, [{ id: "gemini-4-argon-medium", name: "Argon" }]);
  // Catalog is synthetic and isolated.
  const selected = await getProviderCredentials("antigravity", null, [account.id], "gemini-4-argon");
  expect(selected?.connectionId).toBe(account.id);
});

test("dynamic MITM alias selects its wire-model account and dispatches that same model", async () => {
  const { setMitmAliasAll } = await import("../src/lib/db/models/mitmAlias.ts");
  await setMitmAliasAll("antigravity", { "synthetic-dynamic": "antigravity/synthetic-wire" });
  try {
    const account = await createProviderConnection({ provider: "antigravity", authType: "oauth", accessToken: "synthetic-dynamic", projectId: "dynamic", isActive: true, name: "dynamic" } as any);
    await replaceSyncedAvailableModelsForConnection("antigravity", account.id, [{ id: "synthetic-wire", name: "wire" }]);
    const selected = await getProviderCredentials("antigravity", null, [account.id], "synthetic-dynamic");
    expect(selected?.connectionId).toBe(account.id);
    const wire: string[] = [];
    globalThis.fetch = (async (url, init) => {
      if (String(url).includes("auto-updater")) return Response.json([{ version: "1.0.0" }]);
      wire.push(JSON.parse(await new Response(init?.body as BodyInit).text()).model);
      return Response.json({ response: { candidates: [] } });
    }) as typeof fetch;
    const { AntigravityExecutor } = await import("../open-sse/executors/antigravity.ts");
    await new AntigravityExecutor().execute({ model: "synthetic-dynamic", body: { contents: [{ role: "user", parts: [{ text: "hello" }] }] }, stream: false, credentials: selected, log: { debug() {}, info() {}, warn() {}, error() {} } } as any);
    expect(wire).toEqual(["synthetic-wire"]);
  } finally { await setMitmAliasAll("antigravity", {}); }
});

test("mixed catalogs restrict aliases while unknown stays fail-open and other providers stay literal", async () => {
  const { isModelAdvertisedByConnection: eligible } = await import("../src/domain/connectionModelRules.ts");
  expect(eligible("gemini-4-argon", new Set(["gemini-4-argon-medium"]), "agy")).toBe(true);
  expect(eligible("gemini-4-argon", new Set(["gemini-4-argon-low"]), "agy")).toBe(false);
  expect(eligible("gemini-4-argon", new Set(["gemini-4-argon-medium"]), "other")).toBe(false);
  expect(eligible("gemini-4-argon", undefined, "agy")).toBe(true);
  expect(eligible("gemini-4-argon", new Set(), "agy")).toBe(true);
});

test("literal collision selects literal catalog and sends literal wire model", async () => {
  const literal = await createProviderConnection({ provider: "agy", authType: "oauth", accessToken: "synthetic-literal", projectId: "literal", isActive: true, name: "literal" } as any);
  const alias = await createProviderConnection({ provider: "antigravity", authType: "oauth", accessToken: "synthetic-alias", projectId: "alias", isActive: true, name: "alias" } as any);
  await replaceSyncedAvailableModelsForConnection("agy", literal.id, [{ id: "gemini-4-argon", name: "literal" }]);
  await replaceSyncedAvailableModelsForConnection("antigravity", alias.id, [{ id: "gemini-4-argon-medium", name: "medium" }]);
  const selected = await getProviderCredentials("antigravity", null, [literal.id, alias.id], "gemini-4-argon");
  expect(selected?.connectionId).toBe(literal.id);
  const wire: string[] = [];
  globalThis.fetch = (async (url, init) => {
    if (String(url).includes("auto-updater")) return Response.json([{ version: "1.0.0" }]);
    wire.push(JSON.parse(await new Response(init?.body as BodyInit).text()).model);
    return Response.json({ response: { candidates: [] } });
  }) as typeof fetch;
  const { AntigravityExecutor } = await import("../open-sse/executors/antigravity.ts");
  await new AntigravityExecutor().execute({ model: "gemini-4-argon", body: { contents: [{ role: "user", parts: [{ text: "hello" }] }] }, stream: false, credentials: selected, log: { debug() {}, info() {}, warn() {}, error() {} } } as any);
  expect(wire).toEqual(["gemini-4-argon"]);
});

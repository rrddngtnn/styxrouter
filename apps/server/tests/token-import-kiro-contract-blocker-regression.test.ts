import { expect, test } from "bun:test";
import { KiroExecutor } from "../open-sse/executors/kiro.ts";
import { prepareTokenImport, tokenImportProviders } from "../server/tokenImport.ts";

test("Kiro rejects incomplete external IdP metadata and uses method-specific headers", async () => {
  const entry = tokenImportProviders().find(e => e.id === "kiro");
  expect(entry?.supported).toBe(true);
  const view = prepareTokenImport({ provider: "kiro", accounts: { access_token: "synthetic-kiro-secret", authMethod: "external_idp" } })![0].view;
  expect(view.valid).toBe(false);
  expect(JSON.stringify(view)).not.toContain("synthetic-kiro-secret");
  const executor = new KiroExecutor();
  const original = globalThis.fetch;
  const observed: { url: string; auth: string | null; type: string | null }[] = [];
  globalThis.fetch = (async (url: any, init: any) => {
    const headers = new Headers(init.headers);
    observed.push({ url: String(url), auth: headers.get("authorization"), type: headers.get("tokentype") });
    return new Response("synthetic upstream rejection", { status: 403 });
  }) as typeof fetch;
  try {
    for (const authMethod of ["social", "external_idp"]) {
      const result = await executor.execute({ model: "claude-sonnet-4.5", body: { conversationState: {} }, stream: false, credentials: { accessToken: "synthetic-kiro-secret", providerSpecificData: { authMethod } } } as any);
      expect(result.response.status).toBe(403);
    }
    expect(observed).toHaveLength(2);
    expect(observed[0].auth).toBe("Bearer synthetic-kiro-secret");
    expect(observed[0].type).toBeNull();
    expect(observed[1].type).toBe("EXTERNAL_IDP");
    expect(observed[0].url).toBe("https://codewhisperer.us-east-1.amazonaws.com/generateAssistantResponse");
  } finally { globalThis.fetch = original; }
});

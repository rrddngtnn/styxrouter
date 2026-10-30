import "./helpers/test-secrets";
import { expect, test, spyOn } from "bun:test";
import { createProviderConnection } from "../src/lib/db/providers";
import { createApiKey } from "../src/lib/db/apiKeys";
import { createCombo } from "../src/lib/db/combos";
import { getDbInstance } from "../src/lib/db/core";
import { initTranslators } from "../open-sse/translator/index";
import * as strategy from "../open-sse/services/combo/autoStrategy";
import { getForeignOAuthSessionCount, reserveOAuthSession, _clearOAuthSessionOccupancyForTest } from "../open-sse/services/oauthSessionOccupancy";
import { handleChat } from "../src/sse/handlers/chat";

for (const [label, value] of [["retagged", JSON.stringify({ tags: ["red"] })], ["invalid data", "{"]] as const) {
  test(`tag revalidation ${label} releases only its OAuth reservation`, async () => {
    _clearOAuthSessionOccupancyForTest();
    await initTranslators();
    const account: any = await createProviderConnection({ provider: "codex", authType: "oauth", name: `tag-${label}`, accessToken: "synthetic", isActive: true, providerSpecificData: { tags: ["blue"] } } as any);
    const comboName = `oauth-tag-${label}`;
    await createCombo({ name: comboName, strategy: "priority", models: ["codex/gpt-5.1-codex"], config: { maxRetries: 0 } } as any);
    const key = await createApiKey(`key-${label}`, "test");
    const original = strategy.applyRequestTagRouting;
    let raced = false;
    const spy = spyOn(strategy, "applyRequestTagRouting").mockImplementation(async (...args) => {
      const eligible = await original(...args);
      if (!raced && eligible.length) {
        raced = true;
        getDbInstance().prepare("UPDATE provider_connections SET provider_specific_data = ? WHERE id = ?").run(value, account.id);
      }
      return eligible;
    });
    const fetchOriginal = globalThis.fetch;
    let sent = 0;
    globalThis.fetch = (async (url: any, options: any) => {
      if (String(url).startsWith("http://127.0.0.1:")) return fetchOriginal(url, options);
      sent++;
      throw new Error("unexpected upstream request");
    }) as typeof fetch;
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handleChat });
    // A concurrent session must survive the rejected request's cleanup.
    const releaseOther = reserveOAuthSession(account.id, "other-session");
    try {
      const response = await fetchOriginal(`http://127.0.0.1:${server.port}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key.key}` }, body: JSON.stringify({ model: comboName, messages: [{ role: "user", content: "hi" }], stream: false, metadata: { tags: ["blue"] } }) });
      await response.text();
      expect(raced).toBe(true);
      expect(sent).toBe(0);
      expect(response.status).not.toBe(200);
      expect(getForeignOAuthSessionCount(account.id, null)).toBe(1);
      releaseOther();
      expect(getForeignOAuthSessionCount(account.id, null)).toBe(0);
    } finally { releaseOther(); server.stop(true); globalThis.fetch = fetchOriginal; spy.mockRestore(); _clearOAuthSessionOccupancyForTest(); }
  }, 60000);
}

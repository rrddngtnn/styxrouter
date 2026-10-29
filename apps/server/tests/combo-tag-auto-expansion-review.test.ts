import { expect, test } from "bun:test";
import { createProviderConnection } from "../src/lib/db/providers";
import { resolveAutoStrategyOrder } from "../open-sse/services/combo/resolveAutoStrategy";
import { resolveResilienceSettings } from "../src/lib/resilience/settings";

test("auto expansion never reintroduces accounts excluded by request tags", async () => {
  await createProviderConnection({ provider: "openai", authType: "apikey", name: "red", apiKey: "synthetic-red", providerSpecificData: { tags: ["red"] } } as any);
  let observed: any[] = [];
  await resolveAutoStrategyOrder({
    orderedTargets: [], body: { messages: [{ role: "user", content: "hello" }], metadata: { tags: ["blue"] } },
    combo: { name: "synthetic-auto", models: [] }, settings: {}, config: {},
    resilienceSettings: resolveResilienceSettings(null), log: { info() {}, warn() {}, debug() {} },
    buildAutoCandidates: async (targets: any[]) => { observed = targets; return []; },
  } as any);
  expect(observed).toEqual([]);
}, 30000);

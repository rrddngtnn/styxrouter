import { expect, test } from "bun:test";
import { createProviderConnection } from "../src/lib/db/providers";
import { applyRequestTagRouting } from "../open-sse/services/combo/autoStrategy";

test("tag routing rejects a pinned account outside the step allowlist", async () => {
  const pinned = await createProviderConnection({ provider: "openai", authType: "apikey", name: "pinned", apiKey: "fixture-key", providerSpecificData: { tags: ["blue"] } } as any);
  const target = { provider: "openai", providerId: "openai", connectionId: pinned.id, allowedConnectionIds: ["different-account"] } as any;
  expect(await applyRequestTagRouting([target], { metadata: { tags: ["blue"] } }, {})).toEqual([]);
  const allowed = { ...target, allowedConnectionIds: [pinned.id] };
  expect(await applyRequestTagRouting([allowed], { metadata: { tags: ["blue"] } }, {})).toEqual([allowed]);
  expect(await applyRequestTagRouting([allowed], { metadata: { tags: ["red"] } }, {})).toEqual([]);
});

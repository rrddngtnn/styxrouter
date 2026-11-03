import { expect, test } from "bun:test";
import { sanitizeQuotaProvider } from "../src/shared/contracts/quota";
test("cached reset-credit failure provenance survives quota sanitization", () => {
  expect(sanitizeQuotaProvider({ provider: "codex", bankedResetCredits: 2, bankedResetCreditsStale: true })).toMatchObject({ bankedResetCredits: 2, bankedResetCreditsStale: true });
});
test("fractional reset counts are unknown, not silently rounded down", () => {
  expect(sanitizeQuotaProvider({ provider: "codex", bankedResetCredits: 1.9 }).bankedResetCredits).toBeUndefined();
});

import "./helpers/test-secrets";
import { expect, test } from "bun:test";
import { z } from "zod";
import { validateProviderSpecificData } from "../src/shared/validation/providerSpecificData.ts";
import { ANTIGRAVITY_CLIENT_PROFILE_VALUES, ANTIGRAVITY_CLIENT_PROFILE_OPTIONS } from "../src/shared/constants/antigravityClientProfile.ts";
const schema = z.record(z.string(), z.unknown()).superRefine(validateProviderSpecificData);
test("only Hub and CLI are selectable; legacy IDE updates normalize rather than fail", () => {
  expect(ANTIGRAVITY_CLIENT_PROFILE_VALUES).toEqual(["hub", "cli"]);
  expect(ANTIGRAVITY_CLIENT_PROFILE_OPTIONS.map(x => x.value)).toEqual(["hub", "cli"]);
  for (const value of ["hub", "cli", "ide", " IDE "]) {
    expect(schema.safeParse({ clientProfile: value }).success).toBe(true);
  }
  for (const value of ["harness", "sdk", "bad", 3]) expect(schema.safeParse({clientProfile:value}).success).toBe(false);
});

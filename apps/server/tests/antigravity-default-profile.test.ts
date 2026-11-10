import "./helpers/test-secrets";
import { afterEach, expect, test } from "bun:test";
import { getAntigravityClientProfile, withResolvedAntigravityClientProfile } from "../open-sse/services/antigravityClientProfile.ts";
import { normalizeAntigravityClientProfile } from "../src/shared/constants/antigravityClientProfile.ts";

const originalProfile = process.env.STYX_ANTIGRAVITY_CLIENT_PROFILE;
afterEach(() => {
  if (originalProfile === undefined) delete process.env.STYX_ANTIGRAVITY_CLIENT_PROFILE;
  else process.env.STYX_ANTIGRAVITY_CLIENT_PROFILE = originalProfile;
});

test("unconfigured clients use Hub with CLI opt-in and legacy IDE normalized to Hub", () => {
  delete process.env.STYX_ANTIGRAVITY_CLIENT_PROFILE;
  for (const value of [undefined, null, "", "invalid", {}]) {
    expect(normalizeAntigravityClientProfile(value)).toBe("hub");
    expect(getAntigravityClientProfile({ providerSpecificData: { clientProfile: value } })).toBe("hub");
  }
  for (const profile of ["ide", "cli", "hub"] as const) {
    const credentials = { providerSpecificData: { clientProfile: profile } };
    expect(getAntigravityClientProfile(credentials)).toBe(profile === "ide" ? "hub" : profile);
    process.env.STYX_ANTIGRAVITY_CLIENT_PROFILE = "invalid";
    expect(getAntigravityClientProfile(credentials)).toBe(profile === "ide" ? "hub" : profile);
    process.env.STYX_ANTIGRAVITY_CLIENT_PROFILE = " CLI ";
    expect(getAntigravityClientProfile(credentials)).toBe("cli");
    delete process.env.STYX_ANTIGRAVITY_CLIENT_PROFILE;
  }
  process.env.STYX_ANTIGRAVITY_CLIENT_PROFILE = " IDE ";
  expect(getAntigravityClientProfile({ providerSpecificData: { clientProfile: "cli" } })).toBe("hub");
  delete process.env.STYX_ANTIGRAVITY_CLIENT_PROFILE;
  expect(normalizeAntigravityClientProfile("harness")).toBe("cli");
  expect(normalizeAntigravityClientProfile("sdk")).toBe("cli");
  expect(getAntigravityClientProfile()).toBe("hub");
  const frozen = withResolvedAntigravityClientProfile({providerSpecificData:{clientProfile:"hub"}});
  process.env.STYX_ANTIGRAVITY_CLIENT_PROFILE = "cli";
  expect(getAntigravityClientProfile(frozen)).toBe("hub");
});

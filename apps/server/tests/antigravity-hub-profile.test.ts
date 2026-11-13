import { afterEach, expect, test } from "bun:test";
import {
  applyAntigravityClientProfileHeaders,
  getAntigravityClientProfile,
  resolveAntigravityClientVersion,
} from "../open-sse/services/antigravityClientProfile.ts";
import { getAntigravityContentHeaders } from "../open-sse/services/antigravityHeaders.ts";

const originalProfile = process.env.STYX_ANTIGRAVITY_CLIENT_PROFILE;
afterEach(() => {
  if (originalProfile === undefined) delete process.env.STYX_ANTIGRAVITY_CLIENT_PROFILE;
  else process.env.STYX_ANTIGRAVITY_CLIENT_PROFILE = originalProfile;
});

const hubCredentials = { projectId: "real-project", providerSpecificData: { clientProfile: "hub" } };

test("explicit process profile overrides connection selection for isolated probes", () => {
  process.env.STYX_ANTIGRAVITY_CLIENT_PROFILE = "hub";
  expect(getAntigravityClientProfile({ providerSpecificData: { clientProfile: "cli" } })).toBe("hub");
  process.env.STYX_ANTIGRAVITY_CLIENT_PROFILE = "unknown";
  expect(getAntigravityClientProfile(hubCredentials)).toBe("hub");
  process.env.STYX_ANTIGRAVITY_CLIENT_PROFILE = " CLI ";
  expect(getAntigravityClientProfile(hubCredentials)).toBe("cli");
});

test("hub version is pinned without release discovery", async () => {
  expect(await resolveAntigravityClientVersion("hub")).toBe("2.31.2");
});

test("hub connection profile enforces the compared identity without a quota project header", () => {
  delete process.env.STYX_ANTIGRAVITY_CLIENT_PROFILE;
  expect(getAntigravityClientProfile(hubCredentials)).toBe("hub");
  const headers = { "uSeR-aGeNt": "stale", "X-Goog-User-Project": "stale", "X-Client-Name": "stale", Authorization: "Bearer test-only" };
  expect(applyAntigravityClientProfileHeaders(headers, hubCredentials, { project: "real-project" })).toBe("hub");
  expect(headers).toEqual({ "User-Agent": "antigravity/hub/2.31.2 (aidev_client; os_type=darwin; arch=arm64)", Authorization: "Bearer test-only" });
  expect(getAntigravityContentHeaders("hub")["User-Agent"]).toBe("antigravity/hub/2.31.2 (aidev_client; os_type=darwin; arch=arm64)");
});

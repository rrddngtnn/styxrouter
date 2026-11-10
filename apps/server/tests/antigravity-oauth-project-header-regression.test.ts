import { afterEach, expect, test } from "bun:test";
import { applyAntigravityClientProfileHeaders } from "../open-sse/services/antigravityClientProfile.ts";
import { ANTIGRAVITY_CONFIG } from "../src/lib/oauth/constants/oauth";
import { createAntigravityOAuthProvider } from "../src/lib/oauth/providers/antigravity.ts";

const originalProfile = process.env.STYX_ANTIGRAVITY_CLIENT_PROFILE;
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalProfile === undefined) delete process.env.STYX_ANTIGRAVITY_CLIENT_PROFILE;
  else process.env.STYX_ANTIGRAVITY_CLIENT_PROFILE = originalProfile;
});

test("cli profile omits x-goog-user-project for shared aicode-consumers project while preserving custom BYOP project", () => {
  delete process.env.STYX_ANTIGRAVITY_CLIENT_PROFILE;
  const cliCredentials = { providerSpecificData: { clientProfile: "cli" } };

  const sharedHeaders: Record<string, string> = { "x-goog-user-project": "stale-project" };
  expect(
    applyAntigravityClientProfileHeaders(sharedHeaders, cliCredentials, {
      project: "aicode-consumers",
    })
  ).toBe("cli");
  expect(sharedHeaders["x-goog-user-project"]).toBeUndefined();

  const customHeaders: Record<string, string> = {};
  expect(
    applyAntigravityClientProfileHeaders(customHeaders, cliCredentials, {
      project: "custom-byop-project-123",
    })
  ).toBe("cli");
  expect(customHeaders["x-goog-user-project"]).toBe("custom-byop-project-123");
});

test("postExchange does not call onboardUser when loadCodeAssist already returns cloudaicompanionProject", async () => {
  const seenUrls: string[] = [];
  globalThis.fetch = (async (url) => {
    const target = String(url);
    seenUrls.push(target);
    if (target.includes("userinfo")) {
      return Response.json({ email: "fixture@example.com" });
    }
    if (target.includes(":loadCodeAssist")) {
      return Response.json({
        cloudaicompanionProject: "aicode-consumers",
        allowedTiers: [{ id: "standard-tier", isDefault: true }],
      });
    }
    if (target.includes(":onboardUser")) {
      throw new Error("onboardUser should not be called when projectId is already discovered");
    }
    throw new Error(`Unexpected URL: ${target}`);
  }) as typeof fetch;

  const provider = createAntigravityOAuthProvider(ANTIGRAVITY_CONFIG, "hub");
  const result = await provider.postExchange({ access_token: "fixture-token" });

  expect(result.projectId).toBe("aicode-consumers");
  expect(result.userInfo.email).toBe("fixture@example.com");
  expect(result.projectDiscoveryOutcome).toBeUndefined();
  expect(seenUrls.some((u) => u.includes(":loadCodeAssist"))).toBe(true);
  expect(seenUrls.some((u) => u.includes(":onboardUser"))).toBe(false);
});

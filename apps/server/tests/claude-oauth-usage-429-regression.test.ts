import "./helpers/test-secrets";
import { afterEach, expect, test } from "bun:test";
import {
  _resetClaudeOauthUsageCooldown,
  isClaudeOauthUsageCoolingDown,
} from "../open-sse/services/claudeUsageCooldown.ts";
import { getClaudeUsage } from "../open-sse/services/usage/claude.ts";
import { createProviderConnection } from "../src/lib/db/providers.ts";
import { updateProviderLimitsCache } from "../src/lib/db/providerLimits.ts";
import { GET as getQuota } from "../src/app/api/usage/quota/route.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  _resetClaudeOauthUsageCooldown();
});

test("getClaudeUsage does not fall back to legacy admin endpoint when OAuth usage returns 429", async () => {
  const urls: string[] = [];
  let callCount = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("/api/claude_cli/bootstrap")) {
      return new Response(
        JSON.stringify({
          oauth_account: {
            account_uuid: "uuid-1",
            account_email: "user@example.com",
            organization_rate_limit_tier: "default_raven",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    if (url.includes("/api/oauth/usage")) {
      callCount += 1;
      if (callCount === 1) {
        return new Response(
          JSON.stringify({
            five_hour: { utilization: 52, resets_at: "2026-10-31T10:20:00.082Z" },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({ error: "rate_limited" }), {
        status: 429,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/v1/settings")) {
      return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;

  const first = (await getClaudeUsage("sk-ant-oat01-test-token")) as Record<string, any>;
  expect(first.quotas?.["session (5h)"]?.remaining).toBe(48);

  const second = (await getClaudeUsage("sk-ant-oat01-test-token")) as Record<string, any>;
  expect(isClaudeOauthUsageCoolingDown("sk-ant-oat01-test-token")).toBe(true);
  expect(urls.some((u) => u.includes("/v1/settings"))).toBe(false);
  expect(second.message).not.toBe("Claude connected. Usage API requires admin permissions.");
  expect(second.quotas?.["session (5h)"]?.remaining).toBe(48);

  // Third call during cooldown also reuses cached OAuth usage without hitting legacy /v1/settings
  const third = (await getClaudeUsage("sk-ant-oat01-test-token")) as Record<string, any>;
  expect(urls.some((u) => u.includes("/v1/settings"))).toBe(false);
  expect(third.message).not.toBe("Claude connected. Usage API requires admin permissions.");
  expect(third.quotas?.["session (5h)"]?.remaining).toBe(48);
});

test("GET /api/usage/quota suppresses bogus legacy admin-permissions message on Claude OAuth entries", async () => {
  const conn = await createProviderConnection({
    provider: "claude",
    name: "claude-oauth@example.com",
    authType: "oauth",
    accessToken: "sk-ant-oat01-live",
    isActive: true,
    testStatus: "active",
  });

  updateProviderLimitsCache(conn.id, () => ({
    quotas: {
      "session (5h)": {
        used: 52,
        total: 100,
        remaining: 48,
        resetAt: "2026-10-31T10:20:00.082Z",
        remainingPercentage: 48,
        unlimited: false,
      },
    },
    windowFetchedAt: { "session (5h)": "2026-10-31T05:54:11.342Z" },
    staleWindows: [],
    refreshFailed: true,
    plan: "default_raven",
    message: "Claude connected. Usage API requires admin permissions.",
    fetchedAt: "2026-10-31T05:54:11.342Z",
    source: "scheduled",
  }));

  const res = await getQuota(
    new Request(`http://localhost/api/usage/quota?connectionId=${encodeURIComponent(conn.id)}`)
  );
  const body = (await res.json()) as { providers: Array<{ message: string | null; windows: Array<{ stale?: boolean }> }> };
  expect(body.providers).toHaveLength(1);
  expect(body.providers[0].message).toBeNull();
});

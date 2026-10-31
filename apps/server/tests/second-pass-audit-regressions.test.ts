import "./helpers/test-secrets";
import { afterEach, expect, test } from "bun:test";
import { pollForToken } from "../src/lib/oauth/providers.ts";
import { zaiGlmProvider, ZAI_GLM_CONFIG } from "../src/lib/oauth/providers/zai-glm.ts";
import { createProviderConnection } from "../src/lib/db/providers.ts";
import { updateProviderLimitsCache } from "../src/lib/db/providerLimits.ts";
import { getSanitizedCachedProviderLimitsMap } from "../src/lib/usage/providerLimits.ts";
import { mergeProviderLimitsCacheEntry } from "../src/lib/usage/providerLimitsCache.ts";
import {
  finalizePendingRequestById,
  getCompletedDetails,
  getPendingRequests,
  trackPendingRequest,
} from "../src/lib/usage/usageHistory.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("pollForToken marks slow_down as pending: true so device-code callers keep polling", async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ msg: "Too Many Requests" }), {
      status: 429,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;

  const res = await pollForToken("glm", "flow-slow-down", "", {
    _zcodePollToken: "poll-secret-token",
  });

  expect(res.success).toBe(false);
  expect(res.error).toBe("slow_down");
  expect(res.pending).toBe(true);
});

test("zaiGlmProvider.pollToken handles non-JSON HTTP 200 bodies as authorization_pending instead of throwing", async () => {
  globalThis.fetch = (async () =>
    new Response("<html>gateway challenge</html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    })) as unknown as typeof fetch;

  const res = await zaiGlmProvider.pollToken(ZAI_GLM_CONFIG, "flow-html", {
    _zcodePollToken: "poll-secret-token",
  });

  expect(res.ok).toBe(true);
  expect(res.data.error).toBe("authorization_pending");
});

test("getSanitizedCachedProviderLimitsMap strips bogus Claude OAuth legacy admin-permissions error and merge preserves plan", async () => {
  const conn = await createProviderConnection({
    provider: "claude",
    name: "claude-sanitize@example.com",
    authType: "oauth",
    accessToken: "sk-ant-oat01-sanitize",
    isActive: true,
    testStatus: "active",
  });

  updateProviderLimitsCache(conn.id, () => ({
    quotas: {
      "session (5h)": {
        used: 40,
        total: 100,
        remaining: 60,
        resetAt: "2026-10-31T10:20:00.082Z",
        remainingPercentage: 60,
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

  const map = await getSanitizedCachedProviderLimitsMap();
  expect(map[conn.id]?.message).toBeNull();
  expect(map[conn.id]?.refreshFailed).toBeUndefined();

  // Merging a cold-cooldown empty quotas payload must not wipe out previous plan
  const merged = mergeProviderLimitsCacheEntry(
    "claude",
    {
      quotas: {},
      plan: null,
      message: null,
      fetchedAt: "2026-10-31T06:00:00.000Z",
      source: "scheduled",
    },
    map[conn.id]
  );
  expect(merged.plan).toBe("default_raven");
  expect(merged.quotas?.["session (5h)"]).toBeDefined();
});

test("trackPendingRequest(false) with requestId removes the failing request instead of shifting an older in-flight sibling", () => {
  const connId = "conn-concurrent-pending";
  const idA = trackPendingRequest("claude-opus-4-8", "claude", connId, true, {
    correlationId: "req-A-older-survivor",
  });
  const idB = trackPendingRequest("claude-opus-4-8", "claude", connId, true, {
    correlationId: "req-B-newer-failed",
  });
  expect(typeof idA).toBe("string");
  expect(typeof idB).toBe("string");

  // Newer Request B fails early and unregisters itself by idB
  trackPendingRequest("claude-opus-4-8", "claude", connId, false, undefined, idB);

  // Older Request A is still in flight and must finalize by its own idA with its own correlationId
  const finalized = finalizePendingRequestById(idA, { stage: "completed" });
  expect(finalized).toBe(true);

  const completed = getCompletedDetails().get(idA!);
  expect(completed?.correlationId).toBe("req-A-older-survivor");
  expect(getPendingRequests().byAccount[connId]).toBeUndefined();
});

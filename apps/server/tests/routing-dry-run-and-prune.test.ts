import "./helpers/test-secrets";
import { expect, test } from "bun:test";
import { createAdminApi2 } from "../server/admin2";
import { createCombo } from "../src/lib/db/combos";
import { createProviderConnection, updateProviderConnection } from "../src/lib/db/providers";
import { getDbInstance } from "../src/lib/db/core";

test("POST /routing/dry-run simulates combo resolution and reports per-step account eligibility without hitting upstream", async () => {
  const app = createAdminApi2();
  const c1 = (await createProviderConnection({
    provider: "glm",
    authType: "apikey",
    name: "glm-cooling",
    apiKey: "test-key-1",
    isActive: true,
  })) as { id: string };
  await updateProviderConnection(c1.id, {
    rateLimitedUntil: new Date(Date.now() + 60_000).toISOString(),
  });

  const c2 = (await createProviderConnection({
    provider: "glm",
    authType: "apikey",
    name: "glm-healthy",
    apiKey: "test-key-2",
    isActive: true,
  })) as { id: string };

  const c3 = (await createProviderConnection({
    provider: "antigravity",
    authType: "oauth",
    name: "ag-exhausted",
    accessToken: "fake-ag",
    isActive: true,
  })) as { id: string };
  const { setQuotaCache } = await import("../src/domain/quotaCache");
  setQuotaCache(c3.id, "antigravity", {
    "gemini-4-argon-medium": {
      used: 1000,
      total: 1000,
      remaining: 0,
      remainingPercentage: 0,
      resetAt: new Date(Date.now() + 3600_000).toISOString(),
    },
  });

  await createCombo({
    name: "dry-run-combo",
    strategy: "priority",
    models: ["openai/gpt-4o", "antigravity/gemini-4-argon-medium", "glm/glm-5.3"],
  } as never);

  const res = await app.request("/routing/dry-run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ target: "dry-run-combo" }),
  });
  expect(res.status).toBe(200);
  const data = (await res.json()) as {
    target: string;
    isCombo: boolean;
    winner: { stepIndex: number; provider: string; model: string; accountId: string; accountName: string | null } | null;
    steps: Array<{
      stepIndex: number;
      rawTarget: string;
      provider: string;
      model: string;
      eligibleCount: number;
      candidates: Array<{ id: string; name: string | null; eligible: boolean; reason: string }>;
    }>;
  };

  expect(data.isCombo).toBe(true);
  expect(data.steps).toHaveLength(3);
  expect(data.steps[0]?.provider).toBe("openai");
  expect(data.steps[0]?.eligibleCount).toBe(0);
  expect(data.steps[1]?.provider).toBe("antigravity");
  expect(data.steps[1]?.eligibleCount).toBe(0);
  expect(data.steps[1]?.candidates[0]?.reason).toContain("quota exhausted");
  expect(data.steps[2]?.provider).toBe("glm");
  expect(data.steps[2]?.eligibleCount).toBe(1);
  expect(data.winner?.provider).toBe("glm");
  expect(data.winner?.accountId).toBe(c2.id);
  expect(data.winner?.accountName).toBe("glm-healthy");
  const coolingCandidate = data.steps[2]?.candidates.find((c) => c.id === c1.id);
  expect(coolingCandidate?.eligible).toBe(false);
  expect(coolingCandidate?.reason).toContain("cooldown");
});

test("POST /storage/prune deletes call_logs and proxy_logs older than retentionDays", async () => {
  const app = createAdminApi2();
  const db = getDbInstance();
  const oldTs = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const newTs = new Date().toISOString();

  db.prepare(
    "INSERT INTO call_logs (id, timestamp, method, path, status, model, provider) VALUES (?, ?, 'POST', '/v1/chat/completions', 200, 'glm-5.3', 'glm')",
  ).run("old-call-1", oldTs);
  db.prepare(
    "INSERT INTO call_logs (id, timestamp, method, path, status, model, provider) VALUES (?, ?, 'POST', '/v1/chat/completions', 200, 'glm-5.3', 'glm')",
  ).run("new-call-1", newTs);

  const res = await app.request("/storage/prune", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ retentionDays: 7, vacuum: false }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    success: boolean;
    deletedCallLogs: number;
    deletedProxyLogs: number;
  };
  expect(body.success).toBe(true);
  expect(body.deletedCallLogs).toBeGreaterThanOrEqual(1);

  const remaining = db
    .prepare("SELECT id FROM call_logs WHERE id IN ('old-call-1', 'new-call-1')")
    .all() as Array<{ id: string }>;
  expect(remaining.map((r) => r.id)).toEqual(["new-call-1"]);
});

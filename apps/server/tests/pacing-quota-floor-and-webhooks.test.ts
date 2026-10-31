import "./helpers/test-secrets";
import { expect, test } from "bun:test";
import { createAdminApi2 } from "../server/admin2";
import { createProviderConnection, updateProviderConnection } from "../src/lib/db/providers";
import { updateSettings } from "../src/lib/db/settings";
import { setQuotaCache } from "../src/domain/quotaCache";
import { getProviderCredentials } from "../src/sse/services/auth";

test("Soft Quota Floor (softQuotaFloorPercent) deprioritizes low-quota accounts when a healthier peer exists", async () => {
  await updateSettings({
    fallbackStrategy: "priority",
    softQuotaFloorPercent: 10,
  });

  const lowQuota = (await createProviderConnection({
    provider: "antigravity",
    authType: "oauth",
    name: "ag-low-3pct",
    accessToken: "token-low",
    priority: 1,
    isActive: true,
  })) as { id: string };
  setQuotaCache(lowQuota.id, "antigravity", {
    "gemini-4-argon-medium": {
      used: 970,
      total: 1000,
      remaining: 30,
      remainingPercentage: 3,
      resetAt: new Date(Date.now() + 3600_000).toISOString(),
    },
  });

  const healthyQuota = (await createProviderConnection({
    provider: "antigravity",
    authType: "oauth",
    name: "ag-healthy-80pct",
    accessToken: "token-healthy",
    priority: 2,
    isActive: true,
  })) as { id: string };
  setQuotaCache(healthyQuota.id, "antigravity", {
    "gemini-4-argon-medium": {
      used: 200,
      total: 1000,
      remaining: 800,
      remainingPercentage: 80,
      resetAt: new Date(Date.now() + 3600_000).toISOString(),
    },
  });

  const selected = (await getProviderCredentials(
    "antigravity",
    null,
    null,
    "gemini-4-argon-medium",
  )) as { connectionId?: string } | null;
  expect(selected?.connectionId).toBe(healthyQuota.id);

  await updateSettings({ softQuotaFloorPercent: 0 });
});

test("Account Pacing (accountMinSpacingMs) skips an account used within the spacing window when a sibling is available", async () => {
  await updateSettings({
    fallbackStrategy: "priority",
    accountMinSpacingMs: 5000,
  });

  const recentConn = (await createProviderConnection({
    provider: "glm",
    authType: "apikey",
    name: "glm-just-used",
    apiKey: "key-recent",
    priority: 1,
    isActive: true,
  })) as { id: string };
  await updateProviderConnection(recentConn.id, {
    lastUsedAt: new Date().toISOString(),
  });

  const idleConn = (await createProviderConnection({
    provider: "glm",
    authType: "apikey",
    name: "glm-idle",
    apiKey: "key-idle",
    priority: 2,
    isActive: true,
  })) as { id: string };

  const selected = (await getProviderCredentials("glm", null, null, "glm-5.3")) as {
    connectionId?: string;
  } | null;
  expect(selected?.connectionId).toBe(idleConn.id);

  await updateSettings({ accountMinSpacingMs: 0 });
});

test("Webhook Alerts CRUD API lists, creates, toggles, and deletes webhook subscriptions without leaking secrets", async () => {
  const app = createAdminApi2();

  const createRes = await app.request("/webhooks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: "https://hooks.example.com/styx-alerts",
      kind: "telegram",
      description: "Ops Alert Channel",
      events: ["quota.exceeded", "request.failed"],
    }),
  });
  expect(createRes.status).toBe(201);
  const created = (await createRes.json()) as {
    webhook: { id: string; url: string; kind: string; enabled: boolean; secret?: string };
  };
  expect(created.webhook.id).toBeTruthy();
  expect(created.webhook.kind).toBe("telegram");
  expect(created.webhook.enabled).toBe(true);
  expect(created.webhook.secret).toBeUndefined();

  const listRes = await app.request("/webhooks");
  expect(listRes.status).toBe(200);
  const listed = (await listRes.json()) as { webhooks: Array<{ id: string; secret?: string }> };
  expect(listed.webhooks.some((w) => w.id === created.webhook.id)).toBe(true);
  expect(JSON.stringify(listed)).not.toContain("whsec_");

  const patchRes = await app.request(`/webhooks/${created.webhook.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled: false }),
  });
  expect(patchRes.status).toBe(200);
  const patched = (await patchRes.json()) as { webhook: { enabled: boolean } };
  expect(patched.webhook.enabled).toBe(false);

  const delRes = await app.request(`/webhooks/${created.webhook.id}`, {
    method: "DELETE",
  });
  expect(delRes.status).toBe(200);
});

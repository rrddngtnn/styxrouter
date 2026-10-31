import "./helpers/test-secrets";
import { expect, test } from "bun:test";
import { createAdminApi2 } from "../server/admin2";
import { createCombo } from "../src/lib/db/combos";
import { createProviderConnection, patchProviderConnectionTagsWithAudit } from "../src/lib/db/providers";
import { isModelLocked, recordModelLockoutFailure } from "../open-sse/services/accountFallback";
import { resolveProxyForConnection } from "../src/lib/db/settings";

test("POST /process-health/clear-model-locks clears in-memory model lockouts and returns cleared count", async () => {
  const app = createAdminApi2();
  recordModelLockoutFailure("antigravity", "conn-lock-1", "gemini-4-argon-medium", 429, "rate_limit");
  recordModelLockoutFailure("antigravity", "conn-lock-1", "gemini-4-argon-medium", 429, "rate_limit");
  recordModelLockoutFailure("antigravity", "conn-lock-1", "gemini-4-argon-medium", 429, "rate_limit");
  expect(isModelLocked("antigravity", "conn-lock-1", "gemini-4-argon-medium")).toBe(true);

  const res = await app.request("/process-health/clear-model-locks", { method: "POST" });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { success: boolean; cleared: number };
  expect(body.success).toBe(true);
  expect(body.cleared).toBeGreaterThanOrEqual(1);
  expect(isModelLocked("antigravity", "conn-lock-1", "gemini-4-argon-medium")).toBe(false);
});

test("GET/PUT /proxies/config sets global and provider-level proxy and redacts passwords on read", async () => {
  const app = createAdminApi2();
  const conn = (await createProviderConnection({
    provider: "codebuddy-cn",
    authType: "oauth",
    name: "cbcn-proxied",
    accessToken: "fake-cbcn",
    isActive: true,
  })) as { id: string };

  const putRes = await app.request("/proxies/config", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      level: "provider",
      id: "codebuddy-cn",
      proxyUrl: "http://proxyuser:supersecretpass@198.51.100.10:8080",
    }),
  });
  expect(putRes.status).toBe(200);

  const getRes = await app.request("/proxies/config");
  expect(getRes.status).toBe(200);
  const cfg = (await getRes.json()) as {
    providers: Record<string, { host: string; port: string | number; username?: string; password?: string }>;
  };
  expect(cfg.providers["codebuddy-cn"]?.host).toBe("198.51.100.10");
  expect(JSON.stringify(cfg)).not.toContain("supersecretpass");

  const resolved = await resolveProxyForConnection(conn.id);
  expect(resolved.level).toBe("provider");
  expect((resolved.proxy as { host?: string })?.host).toBe("198.51.100.10");

  // Clear provider proxy
  const clearRes = await app.request("/proxies/config", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      level: "provider",
      id: "codebuddy-cn",
      proxyUrl: null,
    }),
  });
  expect(clearRes.status).toBe(200);
});

test("Dry-run simulator honors per-step tags on combo steps", async () => {
  const app = createAdminApi2();
  const cUntagged = (await createProviderConnection({
    provider: "glm",
    authType: "apikey",
    name: "glm-untagged",
    apiKey: "key-u",
    priority: 1,
    isActive: true,
  })) as { id: string };

  const cTagged = (await createProviderConnection({
    provider: "glm",
    authType: "apikey",
    name: "glm-hermes",
    apiKey: "key-t",
    priority: 2,
    isActive: true,
  })) as { id: string };
  patchProviderConnectionTagsWithAudit(cTagged.id, "add", ["@hermes"]);

  await createCombo({
    name: "tagged-combo",
    strategy: "priority",
    models: [{ model: "glm/glm-5.3", tags: ["@hermes"] }],
  } as never);

  const res = await app.request("/routing/dry-run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ target: "tagged-combo" }),
  });
  expect(res.status).toBe(200);
  const data = (await res.json()) as {
    winner: { accountId: string; accountName: string | null } | null;
  };
  expect(data.winner?.accountId).toBe(cTagged.id);
  expect(data.winner?.accountName).toBe("glm-hermes");
  expect(data.winner?.accountId).not.toBe(cUntagged.id);
});

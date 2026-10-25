// StyxRouter Hono+Bun entrypoint.
// Thin HTTP layer; routing/dispatch logic lives in open-sse.

import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { handleChat } from "../src/sse/handlers/chat.ts";
import { initTranslators } from "../open-sse/translator/index.ts";
import { getProviderConnections } from "../src/lib/db/providers.ts";
import { REGISTRY } from "../open-sse/config/providers/index.ts";
import { getProviderLabel } from "../src/shared/constants/providers.ts";
import { getSettings } from "../src/lib/db/settings.ts";
import { PROVIDERS as OAUTH_PROVIDERS } from "../src/lib/oauth/providers/index.ts";
import { getCombos } from "../src/lib/db/combos.ts";
import { getApiKeys } from "../src/lib/db/apiKeys.ts";
import { getRequestDetailLogs } from "../src/lib/db/detailedLogs.ts";
import { getUnifiedModelsResponse } from "../src/app/api/v1/models/catalog.ts";

import { createModelMetadataApi, type ModelMetadataEnv } from "./modelMetadata.ts";
import { authLogin, authLogout, authStatus, requireAuth } from "./auth.ts";
import { createAdminApi } from "./admin.ts";
import { createOAuthApi } from "./oauth.ts";
import { createUpstreamApi } from "./upstream.ts";
import { createBackupsApi, startBackupScheduler } from "./backups.ts";
import { createV1Api } from "./v1.ts";

const app = new Hono<ModelMetadataEnv>();
// Registered first so it runs before every route below, including the mounted sub-app.
app.use("*", requireAuth);
app.route("/api/model-metadata", createModelMetadataApi());

// Root `/` redirects to the panel so a bare domain hit lands somewhere useful
// instead of returning Hono's default 404. Keep this before any wildcard
// handlers so it wins the match.
app.get("/", (c) => c.redirect("/panel/", 302));

const startedAt = Date.now();

let translatorsReady: Promise<unknown> | null = null;
function ensureTranslators() {
  if (!translatorsReady) translatorsReady = Promise.resolve(initTranslators());
  return translatorsReady;
}

app.get("/api/health", (c) => c.json({ ok: true, host: "hono-bun", version: "styx-0.1" }));

// Dashboard health card expects uptime + version
app.get("/api/health/ping", (c) =>
  c.json({
    ok: true,
    uptime_seconds: Math.round((Date.now() - startedAt) / 1000),
    version: "styx-0.1",
  })
);

// Panel auth: real password login, JWT session cookie (see ./auth.ts).
app.get("/api/auth/status", authStatus);
app.post("/api/auth/logout", authLogout);
app.post("/api/auth/login", authLogin);

// Providers list: joins registry metadata with live DB connections.
// Shape matches spike/styx-panel's Provider interface. No credentials returned.
app.get("/api/providers", async (c) => {
  const rows = (await getProviderConnections({}, undefined, undefined, [
    "provider",
    "test_status",
  ])) as Array<{ provider: string; test_status: string | null }>;
  const liveByProvider = new Map<string, { active: number; total: number }>();
  for (const r of rows) {
    const slot = liveByProvider.get(r.provider) ?? { active: 0, total: 0 };
    slot.total += 1;
    if (r.test_status === "active") slot.active += 1;
    liveByProvider.set(r.provider, slot);
  }
  const providers = Object.entries(REGISTRY)
    .filter(([id, entry]) => entry.id === id)
    .map(([id, entry]) => {
      const live = liveByProvider.get(id);
      const authType = entry.authType ?? "none";
      const baseModes = Array.isArray(entry.authModes)
        ? [...entry.authModes]
        : authType !== "none"
          ? [authType]
          : [];
      const hasOauth = Boolean((OAUTH_PROVIDERS as Record<string, any>)[toOauthKey(id)]?.requestDeviceCode);
      const authModes = hasOauth && !baseModes.includes("oauth") ? ["oauth", ...baseModes] : baseModes;
      return {
        id,
        name: getProviderLabel(id, entry.displayName),
        displayName: getProviderLabel(id, entry.displayName),
        vendor: entry.vendor ?? null,
        category: entry.category ?? null,
        authType,
        authModes,
        enabled: !!live && live.total > 0,
        healthy: !!live && live.active > 0,
      };
    });
  return c.json({ providers });
});

// Settings read-only passthrough (Settings page displays as JSON for now).
app.get("/api/settings", async (c) => {
  try {
    const { password: _hash, oidcClientSecret: _secret, ...settings } = (await getSettings()) as Record<string, unknown>;
    return c.json(settings);
  } catch (e: any) {
    return c.json({ error: String(e?.message || e) }, 500);
  }
});

// Usage analytics: real aggregation over usage_history (raw) UNION
// daily_usage_summary (aggregated). Mirrors the upstream route's
// buildUnifiedSource contract — retention cutoff from DB settings, last-30d
// window by default (range query param: 7d/30d/90d/all).
app.get("/api/usage/analytics", async (c) => {
  try {
    const range = c.req.query("range") ?? "30d";
    const days = range === "7d" ? 7 : range === "90d" ? 90 : range === "all" ? null : 30;
    const sinceIso = days
      ? new Date(Date.now() - days * 86400_000).toISOString()
      : null;

    const { buildUnifiedSource, getUsageSummary } = await import(
      "../src/lib/db/usageAnalytics.ts"
    );
    const { getUserDatabaseSettings } = await import("../src/lib/db/databaseSettings.ts");

    const dbSettings = getUserDatabaseSettings();
    const rawRetentionDays = dbSettings?.retention?.usageHistory ?? 30;
    const rawCutoff = new Date();
    rawCutoff.setDate(rawCutoff.getDate() - rawRetentionDays);
    const rawCutoffDate = rawCutoff.toISOString().split("T")[0];

    const { unifiedSource, unifiedParams } = buildUnifiedSource({
      sinceIso,
      untilIso: null,
      rawCutoffDate,
      apiKeyWhere: "",
      apiKeyParams: {},
    });

    const row = getUsageSummary(unifiedSource, unifiedParams);
    return c.json({
      range,
      totals: {
        requests: row.totalRequests,
        input_tokens: row.promptTokens,
        output_tokens: row.completionTokens,
        total_tokens: row.totalTokens,
        successful_requests: row.successfulRequests,
        avg_latency_ms: Math.round(row.avgLatencyMs),
        unique_models: row.uniqueModels,
        unique_accounts: row.uniqueAccounts,
        unique_api_keys: row.uniqueApiKeys,
        first_request: row.firstRequest,
        last_request: row.lastRequest,
      },
    });
  } catch (e: any) {
    return c.json(
      {
        totals: {
          requests: 0,
          input_tokens: 0,
          output_tokens: 0,
          total_tokens: 0,
        },
        error: String(e?.message || e),
      },
    );
  }
});

// Routing/Keys/Activity readers backed by real DB queries. Shape matches the
// panel's useFetch<Row>() interfaces. Credentials never leave the server.
app.get("/api/routing/combos", async (c) => {
  try {
    const combos = await getCombos();
    return c.json({
      combos: combos.map((cb: any) => ({
        id: cb.id,
        name: cb.name,
        strategy: cb.strategy ?? "priority",
        provider: cb.providerDefault ?? cb.provider ?? null,
        model: cb.modelDefault ?? cb.model ?? null,
        enabled: cb.isActive ?? cb.enabled ?? true,
        steps: Array.isArray(cb.models) ? cb.models.length : 0,
        models: Array.isArray(cb.models) ? cb.models : [],
      })),
    });
  } catch (e: any) {
    return c.json({ combos: [], error: String(e?.message || e) });
  }
});

app.get("/api/keys", async (c) => {
  try {
    const limit = Number(c.req.query("limit") ?? 100);
    const keys = await getApiKeys(limit, 0);
    return c.json({
      keys: keys.map((k: any) => ({
        id: k.id,
        name: k.name,
        prefix: k.keyPrefix ?? k.prefix ?? null,
        createdAt: k.createdAt ?? null,
        lastUsedAt: k.lastUsedAt ?? null,
        modelRestrictions: k.allowedModels ?? null,
        allowedModels: k.allowedModels ?? [],
        maxRequestsPerDay: k.maxRequestsPerDay ?? null,
        maxRequestsPerMinute: k.maxRequestsPerMinute ?? null,
        isActive: k.isActive !== false && !k.revokedAt,
        revokedAt: k.revokedAt ?? null,
      })),
    });
  } catch (e: any) {
    return c.json({ keys: [], error: String(e?.message || e) });
  }
});

app.get("/api/activity", (c) => {
  try {
    const limit = Number(c.req.query("limit") ?? 50);
    const rows = getRequestDetailLogs(limit, 0);
    return c.json({
      entries: rows.map((r: any) => ({
        id: r.id,
        ts: r.timestamp ?? r.createdAt ?? null,
        method: r.method ?? "POST",
        path: r.path ?? "/v1/chat/completions",
        provider: r.provider ?? null,
        model: r.model ?? null,
        status: r.statusCode ?? r.status ?? null,
        latencyMs: r.latencyMs ?? null,
        errorCode: r.errorCode ?? null,
      })),
    });
  } catch (e: any) {
    return c.json({ entries: [], error: String(e?.message || e) });
  }
});

// Admin writes (keys, combos). GET readers for the same paths stay in this file.
app.route("/api", createAdminApi());

app.get("/v1/models", (c) => {
  const url = new URL(c.req.url);
  if (!url.searchParams.has("configuredOnly")) url.searchParams.set("configuredOnly", "true");
  return getUnifiedModelsResponse(new Request(url, c.req.raw));
});

// Anthropic- and Responses-style entry points, same gate and dispatcher as chat completions.
app.route("/v1", createV1Api(ensureTranslators));

app.post("/v1/chat/completions", async (c) => {
  await ensureTranslators();
  const body = await c.req.json();
  try {
    const response = await handleChat(c.req.raw as any, null, body);
    return response;
  } catch (e: any) {
    console.error("[STYX]", e?.stack || e);
    return c.json({ error: { message: String(e?.message || e), type: "internal_error" } }, 500);
  }
});

// Operator migration from an StyxRouter install. Re-encrypts credential
// fields in the target SQLite DB under the StyxRouter salt. Loopback-only
// so the secret never leaves the host. A backup is written before the
// first mutation; dry-run skips the backup and the write.
app.post("/api/admin/migrate-from-styx", async (c) => {
  // Loopback guard — the secret is in the body, never let a remote call it
  const remote = c.req.header("x-forwarded-for") || c.req.header("host") || "";
  if (!(remote.startsWith("127.0.0.1") || remote.startsWith("localhost") || remote.startsWith("[::1]"))) {
    return c.json({ error: "loopback only" }, 403);
  }
  const body = await c.req.json().catch(() => ({}) as any);
  const srcDb: string = body.srcDb || "";
  const srcSecret: string = body.srcSecret || "";
  const dryRun: boolean = !!body.dryRun;
  const OLD_SALT = body.oldSalt || "styx-field-encryption-v1";
  const NEW_SALT = body.newSalt || "styx-field-encryption-v1";
  if (!srcDb || !srcSecret) return c.json({ error: "srcDb and srcSecret required" }, 400);

  const { scryptSync, createCipheriv, createDecipheriv, randomBytes } = await import("crypto");
  const fs = await import("fs");
  const bs = (await import("better-sqlite3")).default;

  if (!fs.existsSync(srcDb)) return c.json({ error: `not found: ${srcDb}` }, 400);

  // Backup (unless dry-run)
  let backup: string | null = null;
  if (!dryRun) {
    backup = `${srcDb}.pre-styx-${new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15)}Z`;
    fs.copyFileSync(srcDb, backup);
  }

  const srcKey = scryptSync(srcSecret, OLD_SALT, 32);
  const dstKey = scryptSync(srcSecret, NEW_SALT, 32);

  function decrypt(enc: string, key: Buffer): Buffer {
    const [, , iv, ct, tag] = enc.split(":");
    const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "hex"), { authTagLength: 16 });
    d.setAuthTag(Buffer.from(tag, "hex"));
    return Buffer.concat([d.update(Buffer.from(ct, "hex")), d.final()]);
  }
  function encrypt(plain: Buffer, key: Buffer): string {
    const iv = randomBytes(16);
    const cp = createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
    const ct = Buffer.concat([cp.update(plain), cp.final()]);
    const tag = cp.getAuthTag();
    return `enc:v1:${iv.toString("hex")}:${ct.toString("hex")}:${tag.toString("hex")}`;
  }

  const db = new bs(srcDb);
  const FIELDS = ["api_key", "access_token", "refresh_token", "id_token"];
  const rows = db.prepare(`SELECT rowid, ${FIELDS.join(", ")} FROM provider_connections`).all() as any[];
  let migrated = 0, failed = 0, skipped = 0;
  for (const row of rows) {
    const updates: Record<string, string> = {};
    for (const f of FIELDS) {
      const val = row[f];
      if (!val || !String(val).startsWith("enc:v1:")) continue;
      try {
        const plain = decrypt(val, srcKey);
        updates[f] = dryRun ? "" : encrypt(plain, dstKey);
      } catch {
        failed++;
      }
    }
    if (!Object.keys(updates).length) { skipped++; continue; }
    if (!dryRun) {
      const sets = Object.keys(updates).map((k) => `${k}=@${k}`).join(", ");
      db.prepare(`UPDATE provider_connections SET ${sets} WHERE rowid=@rowid`).run({ ...updates, rowid: row.rowid });
    }
    migrated++;
  }
  db.close();
  return c.json({ migrated, failed, skipped, backup, dryRun });
});

// OAuth device-flow proxy. Panel calls POST /api/oauth/<id>/init to get an
// authUrl + state (so the user opens the browser), then polls /poll until a
// token lands or the request expires. On success the token is encrypted and
// stored as a provider_connections row so dispatch picks it up with no manual
// JWT paste. Only providers whose module exports requestDeviceCode+pollToken
// are supported; unknown ids return 404.
// Some flows return extra per-session secrets in the init response (e.g. Z.ai's
// _zcodePollToken) — those are kept server-side in deviceFlows, never sent to
// the browser, and re-attached on poll.
const deviceFlows = new Map<
  string,
  {
    expiresAt: number;
    extras?: Record<string, unknown>;
    completed?: boolean;
    error?: string;
    polling?: boolean;
  }
>();

async function stepDeviceFlowPoll(providerId: string, state: string, name?: string | null) {
  const mod = (OAUTH_PROVIDERS as Record<string, any>)[toOauthKey(providerId)];
  if (!mod?.pollToken) {
    return { status: 404 as const, body: { error: `oauth not supported for provider '${providerId}'` } };
  }
  const flow = deviceFlows.get(state);
  if (flow?.completed) return { status: 200 as const, body: { ok: true } };
  if (flow?.error) return { status: 400 as const, body: { error: flow.error } };
  if (flow?.polling) return { status: 200 as const, body: { pending: true } };
  if (flow) flow.polling = true;
  try {
    const res = await mod.pollToken(mod.config, state, flow?.extras);
    const errCode = res?.data?.error;
    if (!res?.ok || errCode === "authorization_pending" || errCode === "slow_down") {
      return { status: 200 as const, body: { pending: true } };
    }
    if (errCode || !res?.data?.access_token) {
      const errMsg = res?.data?.error_description || errCode || "oauth authorization failed";
      if (flow) flow.error = String(errMsg);
      return { status: 400 as const, body: { error: errMsg } };
    }
    const { createProviderConnection } = await import("../src/lib/db/providers.ts");
    const canonicalProvider = providerId === "zai" ? "glm" : providerId;
    await createProviderConnection({
      provider: canonicalProvider,
      name: name || `${canonicalProvider}-${Date.now().toString(36).slice(-6)}`,
      authType: "oauth",
      accessToken: res.data.access_token,
      refreshToken: res.data.refresh_token || null,
      tokenExpiresAt: res.data.expires_in
        ? new Date(Date.now() + res.data.expires_in * 1000).toISOString()
        : null,
      providerSpecificData: res.data.provider_specific_data || null,
      isActive: 1,
      testStatus: "active",
    } as any);
    if (flow) flow.completed = true;
    return { status: 200 as const, body: { ok: true } };
  } finally {
    if (flow) flow.polling = false;
  }
}

app.post("/api/oauth/:providerId/init", async (c) => {
  const providerId = c.req.param("providerId");
  const mod = (OAUTH_PROVIDERS as Record<string, any>)[toOauthKey(providerId)];
  if (!mod?.requestDeviceCode) {
    return c.json({ error: `oauth not supported for provider '${providerId}'` }, 404);
  }
  try {
    const dc = await mod.requestDeviceCode(mod.config);
    const {
      device_code: _dc,
      verification_uri: _vu,
      verification_uri_complete: _vuc,
      authUrl: _au,
      user_code: _uc,
      expires_in: _ei,
      interval: _iv,
      ...flowExtras
    } = dc as Record<string, unknown>;
    const state = String(dc.device_code);
    const expiresInSec = Number(dc.expires_in) || 300;
    const intervalSec = Math.max(2, Number(dc.interval) || 3);
    const expiresAt = Date.now() + expiresInSec * 1000;
    deviceFlows.set(state, {
      expiresAt,
      extras: Object.keys(flowExtras).length > 0 ? flowExtras : undefined,
    });
    if (mod.pollToken && !process.env.BUN_TEST) {
      const timer = setInterval(async () => {
        const entry = deviceFlows.get(state);
        if (!entry || entry.completed || entry.error || Date.now() >= entry.expiresAt) {
          clearInterval(timer);
          return;
        }
        try {
          await stepDeviceFlowPoll(providerId, state);
        } catch {
          // ignore transient network errors during background poll
        }
      }, intervalSec * 1000);
      timer.unref?.();
    }
    return c.json({
      providerId,
      authUrl: dc.verification_uri_complete ?? dc.verification_uri ?? dc.authUrl ?? null,
      state,
      userCode: dc.user_code ?? null,
      expiresIn: dc.expires_in ?? null,
      interval: dc.interval ?? 5,
    });
  } catch (e: any) {
    return c.json({ error: String(e?.message || e) }, 500);
  }
});

app.get("/api/oauth/:providerId/poll", async (c) => {
  const providerId = c.req.param("providerId");
  const state = c.req.query("state");
  const name = c.req.query("name");
  if (!state) return c.json({ error: "state required" }, 400);
  try {
    const res = await stepDeviceFlowPoll(providerId, state, name);
    return c.json(res.body, res.status);
  } catch (e: any) {
    return c.json({ error: String(e?.message || e) }, 500);
  }
});

function toOauthKey(providerId: string): string {
  // registry id "codebuddy-intl" -> oauth map key "codebuddyIntl" (kebab -> camel)
  return providerId.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

// Registered after the device-flow routes above on purpose: those win for /init and /poll; every other
// /api/oauth/* path is served by the upstream route modules.
app.route("/api", createOAuthApi());
app.route("/api", createUpstreamApi());
app.route("/api", createBackupsApi());
startBackupScheduler();

app.use(
  "/panel/*",
  serveStatic({
    root: "./panel",
    rewriteRequestPath: (p) => {
      const stripped = p.replace(/^\/panel/, "");
      // Single-page app: any path without a file extension is a client-side route, so serve the shell.
      // A path WITH an extension is an asset and must stay a 404 when it is missing.
      return stripped === "" || stripped === "/" || !/\.[A-Za-z0-9]+$/.test(stripped) ? "/index.html" : stripped;
    },
  })
);

const port = Number(process.env.PORT || 20128);
console.log(`StyxRouter :${port} (Hono+Bun)`);

// ---------------------------------------------------------------------------
// Proactive token health (closes the gap from the host swap): the old
// Next.js instrumentation boot started tokenHealthCheckJob on a timer; the
// Hono host has no scheduler, so refresh only ran on-demand at dispatch —
// first request after expiry paid the refresh latency (or a 401).
//
// This interval re-implements the job directly: every 30 minutes, look at
// OAuth connections whose token_expires_at is within the refresh lead
// window (or already expired) and run the standard refresh pipeline with
// the same circuit breaker the dispatch path uses. Failures just log —
// dispatch-time refresh remains the fallback.
// Disabled when STYX_DISABLE_TOKEN_HEALTHCHECK=1 or STYX_TEST_MODE=1 so
// test/acceptance instances booted against a DB copy never rotate upstream
// single-use OAuth refresh tokens.
// ---------------------------------------------------------------------------
const TOKEN_HEALTH_INTERVAL_MS = 30 * 60 * 1000;
const tokenHealthDisabled =
  process.env.STYX_DISABLE_TOKEN_HEALTHCHECK === "1" ||
  process.env.STYX_DISABLE_TOKEN_HEALTHCHECK === "true" ||
  process.env.STYX_TEST_MODE === "1" ||
  Boolean(process.env.BUN_TEST);

async function runTokenHealthPass(): Promise<void> {
  if (tokenHealthDisabled) return;
  try {
    const { getProviderConnections, updateProviderConnection } = await import(
      "../src/lib/db/providers.ts"
    );
    const { getAccessToken, getRefreshLeadMs, TOKEN_EXPIRY_BUFFER_MS } = await import(
      "../open-sse/services/tokenRefresh.ts"
    );

    const connections = await getProviderConnections({ authType: "oauth", isActive: true }, 500, 0);
    let checked = 0;
    let refreshed = 0;

    for (const conn of connections as any[]) {
      const expiresAt = conn.tokenExpiresAt ? new Date(conn.tokenExpiresAt).getTime() : null;
      if (!expiresAt) continue; // non-expiring credentials (api keys, plan keys)
      const lead = getRefreshLeadMs(conn.provider);
      if (Date.now() < expiresAt - lead - TOKEN_EXPIRY_BUFFER_MS) continue;

      checked++;
      // getAccessToken runs the full pipeline: per-connection mutex, staleness
      // check, provider-specific refresh switch (Google device for antigravity,
      // OpenAI token endpoint for codex, AWS refresh for kiro), and the
      // circuit-breaker retry wrapper. onPersist writes the rotated tokens back.
      const result = await getAccessToken(
        conn.provider,
        {
          refreshToken: conn.refreshToken,
          connectionId: conn.id,
          accessToken: conn.accessToken,
          expiresAt: conn.tokenExpiresAt,
          providerSpecificData: conn.providerSpecificData,
        },
        {
          warn: (...a: unknown[]) => console.warn("[TOKEN-HEALTH]", ...a),
          error: (...a: unknown[]) => console.error("[TOKEN-HEALTH]", ...a),
        },
        null,
        async (persisted) => {
          await updateProviderConnection(conn.id, persisted as Record<string, unknown>);
        },
      );
      if (result?.accessToken) refreshed++;
    }
    if (checked > 0) {
      console.log(`[TOKEN-HEALTH] pass: ${checked} due, ${refreshed} refreshed`);
    }
  } catch (e: any) {
    console.warn("[TOKEN-HEALTH] pass failed:", e?.message || e);
  }
}

if (!tokenHealthDisabled) {
  const tokenHealthTimer = setInterval(runTokenHealthPass, TOKEN_HEALTH_INTERVAL_MS);
  tokenHealthTimer.unref?.(); // never hold the process open on its own
  // first pass shortly after boot (after the DB has settled)
  setTimeout(() => { void runTokenHealthPass(); }, 30_000).unref?.();
}

// Prime version-drift caches and apply persisted DB runtime settings at boot.
void (async () => {
  try {
    const settings = await getSettings();
    const { applyRuntimeSettings } = await import("../src/lib/config/runtimeSettings.ts");
    await applyRuntimeSettings(settings, { force: true, source: "startup" });
  } catch (e: any) {
    console.warn("[BOOT] applyRuntimeSettings failed:", e?.message || e);
  }
  try {
    const { getZcodeVersion } = await import("../open-sse/services/zcodeVersion.ts");
    await getZcodeVersion();
  } catch { /* fail-open — fallback version remains in effect */ }
})();

// Bun's default `export default { port, fetch }` binds to the IPv6 wildcard
// (`*:<port>`) only. Caddy's `reverse_proxy 127.0.0.1:<port>` and shell
// `curl 127.0.0.1:<port>` are IPv4-only, so without an explicit IPv4 hostname
// those probes fail even though the server is listening. Pin `0.0.0.0` to
// cover both IPv4 and IPv6 loopback traffic (dual-stack via mapped v6
// addresses when IPv6 is enabled on the host).
export default {
  port, hostname: "0.0.0.0",
  fetch(request: Request, server?: { requestIP?(request: Request): { address: string } | null }) {
    return app.fetch(request, { peerAddress: server?.requestIP?.(request)?.address });
  },
};

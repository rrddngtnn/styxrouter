/**
 * Z.ai GLM — ZCode CLI OAuth bootstrap.
 *
 * Flow (ZCode CLI server-mediated polling flow):
 *
 *   1. INIT   POST {cliInitUrl}  Authorization: Bearer <rando...hex>
 *             body: { provider: "zai" }
 *             -> { code, data: { flow_id, authorize_url, expires_at, poll_interval_sec } }
 *   2. POLL   GET {cliPollUrl}/{flow_id}  Authorization: Bearer *** random token>
 *             -> data.status: "pending" | "failed" | "ready"
 *                ready -> data[providerId].access_token (JWT)
 *   3. LOGIN  POST {businessLoginUrl} { token: <JWT> }
 *             -> data.access_token = business token
 *   4. RESOLVE GET {apiBaseUrl}/api/biz/customer/getCustomerInfo (business token)
 *             -> organizations[].projects[] (skip projectType "2"), prefer
 *                org/project whose name matches 默认机构/默认项目 (default)
 *   5. KEY    GET  {apiBaseUrl}/api/biz/v1/organization/{orgId}/projects/{projectId}/api_keys
 *             find key named {planApiKeyName} or POST to create it
 *             GET  .../api_keys/copy/{apiKey} -> data.secretKey  (the plan API key)
 *
 * The returned access_token for the connection row is the composite plan API key
 * (`${apiKey}.${secretKey}`), alongside the ZCode platform JWT when present.
 */

import { randomBytes } from "crypto";

const OK_CODES: (string | number | null | undefined)[] = [null, 0, 200, "0", "200"];

function codeOk(code: string | number | null | undefined): boolean {
  return OK_CODES.includes(code);
}

interface ZaiOAuthConfig {
  providerId?: string;
  cliInitUrl: string;
  cliPollUrl: string;
  businessLoginUrl: string;
  apiBaseUrl: string;
  planApiKeyName: string;
}

export const ZAI_GLM_CONFIG: ZaiOAuthConfig = {
  providerId: "zai",
  cliInitUrl: "https://zcode.z.ai/api/v1/oauth/cli/init",
  cliPollUrl: "https://zcode.z.ai/api/v1/oauth/cli/poll",
  businessLoginUrl: "https://api.z.ai/api/auth/z/login",
  apiBaseUrl: "https://api.z.ai",
  planApiKeyName: "zcode-api-key",
};

function isDefaultName(name: unknown): boolean {
  const s = String(name || "").trim().toLowerCase();
  return s.includes("默认机构") || s.includes("默认项目") || s.includes("default");
}

async function zaiFetch<T = any>(
  url: string,
  init: RequestInit,
  label: string,
): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Z.ai ${label} request failed (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Z.ai ${label} response is not valid JSON`);
  }
  if (!codeOk(parsed?.code) || parsed?.success === false) {
    throw new Error(parsed?.msg || `Z.ai ${label} returned business error ${parsed?.code}`);
  }
  return (parsed?.data ?? parsed ?? null) as T;
}

async function businessLogin(cfg: ZaiOAuthConfig, jwt: string): Promise<string> {
  const data = await zaiFetch<any>(
    cfg.businessLoginUrl,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: jwt }),
    },
    "business login",
  );
  const token = String(data?.access_token ?? data?.accessToken ?? "").trim();
  if (!token) throw new Error("Z.ai business login response is missing access_token");
  return token;
}

interface OrgProject { organizationId: string; projectId: string; projectName?: string; projectType?: string }
interface PlanDiscovery { planFamily: "coding" | "start" | "team" | "individual" | null; projectType: string | null; organizationName: string | null; projectName: string | null }

function pickOrgProject(info: any): OrgProject | null {
  const orgs: any[] = Array.isArray(info?.organizations) ? info.organizations : [];
  const withProjects = orgs
    .map((organization) => ({
      organization,
      projects: (organization?.projects || []).filter(
        (p: any) => "2" !== String(p?.projectType ?? "").trim(),
      ),
    }))
    .filter(({ organization, projects }) => !!(organization?.organizationId && projects.length));
  if (!withProjects.length) return null;
  const preferred = withProjects.find(({ organization }) => isDefaultName(organization?.organizationName)) || withProjects[0];
  const project =
    preferred.projects.find((p: any) => isDefaultName(p?.projectName)) || preferred.projects[0];
  if (!preferred.organization?.organizationId || !project?.projectId) return null;
  return {
    organizationId: preferred.organization.organizationId,
    projectId: project.projectId,
    projectName: String(project?.projectName ?? ""),
    projectType: String(project?.projectType ?? ""),
  };
}

/**
 * Infer the subscription plan family from the customer info response. Z.ai
 * never surfaces the plan family as a flat field — it's encoded in the project
 * naming convention and projectType flag that ZCode CLI's own code reads at the
 * same layer (see daiw.org/manual/zcode/accounts-plans). Mapping:
 *   - projectType "2" + name contains "team" → "team"
 *   - project/org name contains "start"/"闲时"  → "start" (Start Plan / off-peak)
 *   - project/org name contains "coding"/"default" → "coding" (Lite/Pro/Max)
 *   - else null (unknown — treat as "coding" at the executor layer)
 * We stash whatever we observe so a later refactor can tighten the mapping
 * without re-running OAuth.
 */
function detectPlanFamily(info: any, chosen: OrgProject | null): PlanDiscovery {
  const orgs: any[] = Array.isArray(info?.organizations) ? info.organizations : [];
  const org = orgs.find((o: any) => o?.organizationId === chosen?.organizationId) ?? orgs[0] ?? null;
  const projectType = chosen?.projectType ?? null;
  const projectName = chosen?.projectName ?? null;
  const organizationName = String(org?.organizationName ?? "") || null;
  const needle = `${organizationName ?? ""} ${projectName ?? ""}`.toLowerCase();
  let planFamily: PlanDiscovery["planFamily"] = null;
  if (projectType === "2") planFamily = "team";
  else if (needle.includes("start") || needle.includes("闲时")) planFamily = "start";
  else if (needle.includes("coding") || needle.includes("default") || needle.includes("默认")) planFamily = "coding";
  return { planFamily, projectType, organizationName, projectName };
}

interface PlanApiKeyResult { apiKey: string; discovery: PlanDiscovery }

async function fetchPlanApiKey(cfg: ZaiOAuthConfig, jwt: string): Promise<PlanApiKeyResult> {
  const businessToken = await businessLogin(cfg, jwt);
  const headers = {
    Authorization: `Bearer ${businessToken}`,
    "Content-Type": "application/json",
  };

  const info = await zaiFetch(`${cfg.apiBaseUrl}/api/biz/customer/getCustomerInfo`, { headers }, "customer info");
  const org = pickOrgProject(info);
  if (!org) throw new Error("Unable to resolve Z.ai organization and project for the coding plan");

  const keysUrl = `${cfg.apiBaseUrl}/api/biz/v1/organization/${org.organizationId}/projects/${org.projectId}/api_keys`;
  let keys: any[] = (await zaiFetch(keysUrl, { headers }, "api keys")) || [];
  let key = Array.isArray(keys) ? keys.find((k: any) => k?.name === cfg.planApiKeyName) : null;
  if (!key) {
    key = await zaiFetch(
      keysUrl,
      { method: "POST", headers, body: JSON.stringify({ name: cfg.planApiKeyName }) },
      "api key create",
    );
  }
  const apiKey = String(key?.apiKey ?? "").trim();
  if (!apiKey) throw new Error("Z.ai api_keys response is missing apiKey");

  const copied = await zaiFetch(
    `${keysUrl}/copy/${encodeURIComponent(apiKey)}`,
    { headers },
    "api key copy",
  );
  const secret = String(copied?.secretKey ?? "").trim();
  if (!secret) throw new Error("Z.ai api key copy response is missing secretKey");
  return { apiKey: `${apiKey}.${secret}`, discovery: detectPlanFamily(info, org) };
}

function expiresInSeconds(expiresAt: unknown): number {
  const n = Number(expiresAt);
  if (!Number.isFinite(n) || n <= 0) return 300;
  const ms = n > 1e12 ? n : 1e3 * n;
  const secs = Math.floor((ms - Date.now()) / 1e3);
  return secs > 0 ? secs : 300;
}

async function checkActiveStartPlan(zcodeJwt: string): Promise<boolean> {
  if (!zcodeJwt || !zcodeJwt.trim()) return false;
  try {
    const platform = process.platform === "win32" ? "windows" : process.platform;
    const arch = process.arch === "x64" ? "amd64" : process.arch;
    const url = `https://zcode.z.ai/api/v1/zcode-plan/billing/balance?app_version=3.16.3&platform=${platform}-${arch}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${zcodeJwt.trim()}`,
        Accept: "application/json",
        "User-Agent": "ZCode/3.16.3",
        "HTTP-Referer": "https://zcode.z.ai",
        "X-Title": "Z Code@cli",
        "X-ZCode-App-Version": "3.16.3",
        "X-Platform": `${platform}-${arch}`,
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return false;
    const parsed: any = await res.json().catch(() => null);
    if (!codeOk(parsed?.code)) return false;
    const plans: any[] = Array.isArray(parsed?.data?.plans) ? parsed.data.plans : [];
    const balances: any[] = Array.isArray(parsed?.data?.balances) ? parsed.data.balances : [];
    const hasActiveStartPlan = plans.some(
      (p) =>
        String(p?.status || "").toLowerCase() === "active" &&
        String(p?.plan_id || p?.name || "").toLowerCase().includes("start")
    );
    const hasStartBalance = balances.some((b) => {
      const rem = Number(b?.remaining_units ?? b?.remainingUnits ?? 0);
      return rem > 0;
    });
    return hasActiveStartPlan || hasStartBalance;
  } catch {
    return false;
  }
}

export const zaiGlmProvider = {
  config: ZAI_GLM_CONFIG,
  flowType: "device_code" as const,

  async requestDeviceCode(cfg: ZaiOAuthConfig = ZAI_GLM_CONFIG) {
    const pollToken = randomBytes(32).toString("hex");
    const res = await fetch(cfg.cliInitUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${pollToken}`,
      },
      body: JSON.stringify({ provider: cfg.providerId || "zai" }),
    });
    if (!res.ok) throw new Error(`ZCode OAuth init failed: ${await res.text()}`);
    const body = await res.json();
    if (!codeOk(body.code) || !body.data) throw new Error(body.msg || "ZCode OAuth init returned no data");
    const d = body.data;
    if (!d.flow_id || !d.authorize_url) throw new Error("ZCode OAuth init response missing flow_id/authorize_url");
    return {
      device_code: d.flow_id as string,
      verification_uri: d.authorize_url as string,
      expires_in: expiresInSeconds(d.expires_at),
      interval: (d.poll_interval_sec as number) || 3,
      _zcodePollToken: pollToken,
    };
  },

  async pollToken(config: ZaiOAuthConfig = ZAI_GLM_CONFIG, deviceCode: string, state?: { _zcodePollToken?: string }) {
    // Sibling convention: (config, deviceCode). `state` carries the
    // per-session poll token when the caller preserved our init response.
    const pollToken = state?._zcodePollToken ?? (deviceCode as any)?._zcodePollToken;
    const flowId = typeof deviceCode === "string" ? deviceCode : (deviceCode as any)?.device_code;
    if (!pollToken || !flowId) {
      return { ok: true, data: { error: "access_denied", error_description: "Missing ZCode poll token — restart the login flow" } };
    }
    const cfg = config;
    const res = await fetch(`${cfg.cliPollUrl}/${encodeURIComponent(flowId)}`, {
      headers: { Authorization: `Bearer ${pollToken}` },
    });
    if (res.status === 429) {
      return { ok: true, data: { error: "slow_down", error_description: "ZCode poll rate-limited (HTTP 429)" } };
    }
    if (res.status >= 500) {
      return { ok: true, data: { error: "authorization_pending", error_description: `ZCode poll temporary error (HTTP ${res.status})` } };
    }
    if (!res.ok) {
      return { ok: true, data: { error: "access_denied", error_description: `ZCode poll failed (HTTP ${res.status})` } };
    }
    const body = await res.json();
    if (!codeOk(body.code)) {
      if (Number(body.code) === 429 || /rate|too many|频繁|限流/i.test(String(body.msg || ""))) {
        return { ok: true, data: { error: "slow_down", error_description: body.msg || "ZCode poll rate-limited" } };
      }
      return { ok: true, data: { error: "access_denied", error_description: body.msg || "ZCode poll failed" } };
    }
    const d = body.data || {};
    if (d.status === "pending") return { ok: true, data: { error: "authorization_pending" } };
    if (d.status === "failed") {
      return { ok: true, data: { error: "access_denied", error_description: "ZCode authorization failed or was cancelled" } };
    }
    if (d.status !== "ready") {
      return { ok: true, data: { error: "authorization_pending", error_description: `Unknown status: ${d.status}` } };
    }
    const byId = d[cfg.providerId || "zai"] || d[d.providerId] || {};
    const zcodeJwt = typeof d.token === "string" ? d.token.trim() : "";
    const jwt = byId.access_token || byId.accessToken || d.accessToken || d.access_token;
    if (!jwt) {
      return { ok: true, data: { error: "access_denied", error_description: "ZCode poll response missing access token" } };
    }
    // Convert JWT to a usable plan API key AND discover the plan family in the
    // same business-token round-trip. Also check the ZCode billing plane with
    // d.token (the ZCode platform JWT) for an active Start Plan bucket.
    const [planRes, isStartPlanOnBillingPlane] = await Promise.all([
      fetchPlanApiKey(cfg, jwt as string),
      checkActiveStartPlan(zcodeJwt),
    ]);
    const { apiKey: planApiKey, discovery } = planRes;
    const effectivePlanFamily = isStartPlanOnBillingPlane ? "start" : discovery.planFamily;
    // Bias the executor's transport selector at connection-save time: Start Plan
    // and off-peak quota live on the Anthropic translation layer; Coding and
    // Team plans live on the OpenAI gateway. The executor still accepts a
    // per-request override via providerSpecificData.primaryTransport.
    const primaryTransport = effectivePlanFamily === "start" ? "anthropic" : null;
    return {
      ok: true,
      data: {
        access_token: planApiKey,
        // GLM plan API keys do not expire; refresh path unused.
        refresh_token: null,
        expires_in: null,
        provider_specific_data: {
          planFamily: effectivePlanFamily,
          projectType: discovery.projectType,
          organizationName: discovery.organizationName,
          projectName: discovery.projectName,
          ...(zcodeJwt ? { zcodeJwtToken: zcodeJwt } : {}),
          ...(primaryTransport ? { primaryTransport } : {}),
        },
      },
    };
  },
};

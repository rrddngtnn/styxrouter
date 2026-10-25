/**
 * GLM (Zhipu) usage fetcher that understands BOTH credential shapes:
 *  - Coding/Team plans: composite `id.secret` coding-plan key → api.z.ai quota API.
 *  - Start Plan (planFamily "start"): no coding-plan key exists; usage comes from
 *    the ZCode plan-billing balance plane using the stored platform JWT.
 *
 * Dispatch rule: when `providerSpecificData.planFamily === "start"` (or an
 * explicit `zcodeJwtToken` is present without an apiKey), query the ZCode
 * billing endpoint and map its per-plan balances into the same quota shape the
 * panel already renders ("5 Hours Quota" / "Weekly Quota" style entries).
 *
 * Header contract mirrors the reference client (zcode-ref quota.go): the
 * billing gateway needs the full `TV` context identity set — User-Agent,
 * HTTP-Referer, X-Title, X-Client-Language, X-Client-Timezone,
 * X-ZCode-App-Version, X-Platform, X-Os-Category, X-Os-Version and the stable
 * per-account `X-Device-Mid`. A missing device header makes the call fail with
 * biz 3001 "parameter error" on campaign gateways.
 */
import { toNumber, toRecord } from "./scalars.ts";
import { type UsageQuota } from "./quota.ts";
import {
  buildGlmQuotaFetch,
  getZcodeDeviceMid,
} from "../../config/glmProvider.ts";
import { getCachedZcodeVersion } from "../../services/zcodeVersion.ts";

type JsonRecord = Record<string, unknown>;

export interface ZcodeBalancePlan {
  plan_id?: string;
  user_plan_id?: string;
  name?: string;
  status?: string;
  ends_at?: number;
}

export interface ZcodeBalanceEntry {
  show_name?: string;
  plan_id?: string;
  user_plan_id?: string;
  plan_type?: string;
  total_units?: number;
  totalUnits?: number;
  used_units?: number;
  usedUnits?: number;
  remaining_units?: number;
  remainingUnits?: number;
  unit_type?: string;
  unitType?: string;
  expires_at?: number;
  capabilities?: string[];
}

interface ZcodeBalanceResponse {
  code?: number;
  msg?: string;
  server_time?: number;
  data?: {
    balances?: ZcodeBalanceEntry[];
    plans?: ZcodeBalancePlan[];
  };
}

function zcodePlatformToken(): string {
  switch (process.platform) {
    case "darwin":
      return process.arch === "arm64" ? "darwin-arm64" : "darwin-x64";
    case "win32":
      return process.arch === "arm64" ? "win-arm64" : "win-x64";
    default:
      return process.arch === "arm64" ? "linux-arm64" : "linux-x64";
  }
}

function zcodeOsCategory(): string {
  if (process.platform === "darwin") return "macos";
  if (process.platform === "win32") return "windows";
  return "linux";
}

function zcodeOsVersion(): string {
  try {
    return `${process.platform}-${(process.versions as Record<string, string>).node ?? "unknown"}`;
  } catch {
    return "unknown";
  }
}

function zcodeBalanceUrl(): string {
  const version = getCachedZcodeVersion();
  return `https://zcode.z.ai/api/v1/zcode-plan/billing/balance?app_version=${encodeURIComponent(version)}&platform=${zcodePlatformToken()}`;
}

function zcodeBalanceHeaders(zcodeJwt: string): Record<string, string> {
  const version = getCachedZcodeVersion();
  return {
    Authorization: `Bearer ${zcodeJwt.trim()}`,
    Accept: "application/json",
    "User-Agent": `ZCode/${version}`,
    "HTTP-Referer": "https://zcode.z.ai",
    "X-Title": "Z Code@cli",
    "X-Client-Language": "en",
    "X-Client-Timezone": "UTC",
    "X-ZCode-App-Version": version,
    "X-Platform": zcodePlatformToken(),
    "X-Os-Category": zcodeOsCategory(),
    "X-Os-Version": zcodeOsVersion(),
    "X-Device-Mid": getZcodeDeviceMid(),
  };
}

function isoReset(value: unknown): string | null {
  const n = toNumber(value, 0);
  if (n > 0) {
    const ms = n > 1e12 ? n : n * 1000;
    return new Date(ms).toISOString();
  }
  return null;
}

function pickNumber(primary: unknown, alternate: unknown, fallback = 0): number {
  const a = toNumber(primary, 0);
  if (a !== 0) return a;
  const b = toNumber(alternate, 0);
  if (b !== 0) return b;
  return fallback;
}

/** Map one balance row to the panel's UsageQuota shape. */
function balanceToQuota(entry: ZcodeBalanceEntry): UsageQuota | null {
  const total = pickNumber(entry.total_units, entry.totalUnits);
  const used = pickNumber(entry.used_units, entry.usedUnits);
  const remaining = pickNumber(
    entry.remaining_units,
    entry.remainingUnits,
    Math.max(0, total - used),
  );
  if (total <= 0 && remaining <= 0 && used <= 0) return null;

  const capped = total > 0 ? Math.max(0, Math.min(total, remaining)) : Math.max(0, remaining);
  const label =
    (typeof entry.show_name === "string" && entry.show_name.trim()) ||
    String(entry.plan_id || entry.plan_type || "Start Plan");
  return {
    used,
    total: total > 0 ? total : capped + used,
    remaining: capped,
    remainingPercentage: total > 0 ? Math.round((capped / total) * 100) : 100,
    resetAt: isoReset(entry.expires_at),
    displayName: label,
    details: Array.isArray(entry.capabilities)
      ? entry.capabilities.map((cap) => ({ name: cap, used: 0 }))
      : [],
    unlimited: false,
  };
}

export async function getZcodeStartPlanUsage(zcodeJwt: string): Promise<JsonRecord> {
  const res = await fetch(zcodeBalanceUrl(), {
    headers: zcodeBalanceHeaders(zcodeJwt),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`ZCode plan billing API error (${res.status})`);
  const body = (await res.json().catch(() => null)) as ZcodeBalanceResponse | null;
  if (!body || typeof body !== "object") {
    throw new Error("Invalid JSON response from ZCode plan billing API");
  }
  if (toNumber(body.code, 0) !== 0) {
    throw new Error(body.msg || "ZCode plan billing request rejected");
  }

  const plans = body.data?.plans ?? [];
  const balances = body.data?.balances ?? [];
  const activePlanKeys = new Set(
    plans
      .filter((p) => String(p?.status || "").toLowerCase() === "active")
      .map((p) => `${String(p?.user_plan_id || "").trim()}\x00${String(p?.plan_id || "").trim()}`),
  );

  const quotas: Record<string, UsageQuota> = {};
  for (const entry of balances) {
    const key = `${String(entry.user_plan_id || "").trim()}\x00${String(entry.plan_id || "").trim()}`;
    if (activePlanKeys.size > 0 && !activePlanKeys.has(key)) continue;
    const quota = balanceToQuota(entry);
    if (!quota) continue;
    const name = quota.displayName || "Start Plan";
    quotas[name] = quota;
  }

  return { plan: "Start Plan", quotas };
}

/**
 * Start-plan-aware GLM usage dispatcher. Falls back to the legacy coding-plan
 * fetcher whenever a composite coding key is present; queries the ZCode billing
 * plane only for start-plan connections that carry a platform JWT.
 */
export async function getGlmUsageWithStartPlan(
  apiKey: string | undefined,
  providerSpecificData: Record<string, unknown> | undefined
): Promise<JsonRecord> {
  const psd = toRecord(providerSpecificData);
  const zcodeJwt = typeof psd?.zcodeJwtToken === "string" ? psd.zcodeJwtToken : "";
  const planFamily = String(psd?.planFamily || "").toLowerCase();
  const isStartPlan = planFamily === "start" || (!apiKey && Boolean(zcodeJwt));

  if (isStartPlan && zcodeJwt) {
    try {
      return await getZcodeStartPlanUsage(zcodeJwt);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { message: `Start Plan usage unavailable: ${message}` };
    }
  }

  const { getGlmUsage } = await import("./glm.ts");
  return getGlmUsage(apiKey || "", providerSpecificData);
}

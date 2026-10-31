import { isQuotaExhaustedForRequest } from "../src/domain/quotaCache.ts";
import { getConnectionRoutingTags } from "../src/domain/tagRouter.ts";
import { getComboByName } from "../src/lib/db/combos.ts";
import { getDbInstance } from "../src/lib/db/core.ts";
import { getProviderConnections, getProviderNodes } from "../src/lib/db/providers.ts";
import { deleteCallLogsBefore } from "../src/lib/usage/callLogRotation.ts";
import { isModelLocked } from "../open-sse/services/accountFallback.ts";
import { parseModel } from "../open-sse/services/model.ts";
import { evaluateQuotaLimitPolicy } from "../src/sse/services/auth.ts";

export interface DryRunCandidate {
  id: string;
  name: string | null;
  eligible: boolean;
  reason: string;
  tags: string[];
  priority: number | null;
}

export interface DryRunStepResult {
  stepIndex: number;
  rawTarget: string;
  provider: string;
  model: string;
  eligibleCount: number;
  selectedAccountId: string | null;
  selectedAccountName: string | null;
  candidates: DryRunCandidate[];
}

export interface DryRunSimulationResult {
  target: string;
  isCombo: boolean;
  strategy: string;
  winner: {
    stepIndex: number;
    rawTarget: string;
    provider: string;
    model: string;
    accountId: string;
    accountName: string | null;
  } | null;
  steps: DryRunStepResult[];
}

function stepTargetString(step: unknown): string {
  if (typeof step === "string") return step;
  if (step && typeof step === "object") {
    const rec = step as Record<string, unknown>;
    return String(rec.model ?? rec.comboName ?? rec.name ?? rec.id ?? "");
  }
  return "";
}

export async function simulateRoutingDryRun(input: {
  target: string;
  tag?: string | null;
}): Promise<DryRunSimulationResult> {
  const rawTarget = input.target.trim();
  const requiredTag = input.tag?.trim().toLowerCase() || null;
  const combo = (await getComboByName(rawTarget)) as {
    name: string;
    strategy?: string;
    models?: unknown[];
  } | null;

  const stepStrings = combo
    ? (Array.isArray(combo.models) ? combo.models : []).map(stepTargetString).filter(Boolean)
    : [rawTarget];

  const [allConnections, allNodes] = await Promise.all([
    getProviderConnections({}) as Promise<Array<Record<string, unknown>>>,
    getProviderNodes() as Promise<Array<Record<string, unknown>>>,
  ]);
  const nodeByPrefix = new Map<string, string>();
  for (const n of allNodes) {
    if (typeof n.prefix === "string" && n.prefix.trim() && typeof n.id === "string") {
      nodeByPrefix.set(n.prefix.trim(), n.id);
    }
  }

  const now = Date.now();
  const steps: DryRunStepResult[] = [];
  let winner: DryRunSimulationResult["winner"] = null;

  for (const [idx, stepStr] of stepStrings.entries()) {
    const parsed = parseModel(stepStr);
    const rawPrefix = stepStr.includes("/") ? stepStr.split("/")[0]! : "";
    const resolvedProvider =
      nodeByPrefix.get(rawPrefix) ?? parsed.provider ?? rawPrefix ?? "unknown";
    const resolvedModel = parsed.model || stepStr;

    const matchingConns = allConnections
      .filter((c) => c.provider === resolvedProvider)
      .sort((a, b) => Number(a.priority ?? 999999) - Number(b.priority ?? 999999));

    const candidates: DryRunCandidate[] = matchingConns.map((c) => {
      const id = String(c.id);
      const name = typeof c.name === "string" && c.name ? c.name : null;
      const isActive = Boolean(c.isActive ?? c.is_active);
      const testStatus = (c.testStatus ?? c.test_status ?? null) as string | null;
      const rateLimitedUntil = (c.rateLimitedUntil ?? c.rate_limited_until ?? null) as string | null;
      const tokenExpiresAt = (c.tokenExpiresAt ?? c.token_expires_at ?? c.expiresAt ?? c.expires_at ?? null) as
        | string
        | null;
      const psd = c.providerSpecificData ?? c.provider_specific_data;
      const tags = getConnectionRoutingTags(psd);

      if (!isActive) {
        return { id, name, eligible: false, reason: "disabled", tags, priority: Number(c.priority ?? 0) };
      }
      if (testStatus === "expired") {
        return { id, name, eligible: false, reason: "token expired", tags, priority: Number(c.priority ?? 0) };
      }
      if (tokenExpiresAt) {
        const expMs = Date.parse(tokenExpiresAt);
        if (Number.isFinite(expMs) && expMs <= now) {
          let parsedPsd: Record<string, unknown> = {};
          try {
            parsedPsd = typeof psd === "string" ? JSON.parse(psd) : (psd as Record<string, unknown>) ?? {};
          } catch {}
          if (parsedPsd.nonRefreshable === true || parsedPsd.importedToken === true) {
            return {
              id,
              name,
              eligible: false,
              reason: "imported token expired",
              tags,
              priority: Number(c.priority ?? 0),
            };
          }
        }
      }
      if (rateLimitedUntil) {
        const untilMs = Date.parse(rateLimitedUntil);
        if (Number.isFinite(untilMs) && untilMs > now) {
          const secs = Math.ceil((untilMs - now) / 1000);
          return {
            id,
            name,
            eligible: false,
            reason: `account cooldown (${secs}s remaining)`,
            tags,
            priority: Number(c.priority ?? 0),
          };
        }
      }
      if (isModelLocked(resolvedProvider, id, resolvedModel)) {
        return {
          id,
          name,
          eligible: false,
          reason: "model-locked in this process",
          tags,
          priority: Number(c.priority ?? 0),
        };
      }
      if (isQuotaExhaustedForRequest(id, resolvedProvider, resolvedModel)) {
        return {
          id,
          name,
          eligible: false,
          reason: "quota exhausted",
          tags,
          priority: Number(c.priority ?? 0),
        };
      }
      let parsedPsdObj: Record<string, unknown> = {};
      try {
        parsedPsdObj = typeof psd === "string" ? JSON.parse(psd) : (psd as Record<string, unknown>) ?? {};
      } catch {}
      const limitCheck = evaluateQuotaLimitPolicy(
        resolvedProvider,
        { id, providerSpecificData: parsedPsdObj } as never,
        resolvedModel,
      );
      if (limitCheck.blocked) {
        return {
          id,
          name,
          eligible: false,
          reason: `quota policy (${limitCheck.reasons.join(", ")})`,
          tags,
          priority: Number(c.priority ?? 0),
        };
      }
      if (requiredTag && !tags.includes(requiredTag)) {
        return {
          id,
          name,
          eligible: false,
          reason: `missing required tag (${requiredTag})`,
          tags,
          priority: Number(c.priority ?? 0),
        };
      }
      return { id, name, eligible: true, reason: "ready", tags, priority: Number(c.priority ?? 0) };
    });

    const eligibleList = candidates.filter((c) => c.eligible);
    const firstEligible = eligibleList[0] ?? null;

    if (!winner && firstEligible) {
      winner = {
        stepIndex: idx + 1,
        rawTarget: stepStr,
        provider: resolvedProvider,
        model: resolvedModel,
        accountId: firstEligible.id,
        accountName: firstEligible.name,
      };
    }

    steps.push({
      stepIndex: idx + 1,
      rawTarget: stepStr,
      provider: resolvedProvider,
      model: resolvedModel,
      eligibleCount: eligibleList.length,
      selectedAccountId: firstEligible?.id ?? null,
      selectedAccountName: firstEligible?.name ?? null,
      candidates,
    });
  }

  return {
    target: rawTarget,
    isCombo: Boolean(combo),
    strategy: combo?.strategy ?? "priority",
    winner,
    steps,
  };
}

export function pruneTelemetryLogs(options: {
  retentionDays: number;
  vacuum?: boolean;
}): {
  cutoffIso: string;
  deletedCallLogs: number;
  deletedArtifacts: number;
  deletedProxyLogs: number;
  vacuumed: boolean;
} {
  const days = Math.max(1, Math.min(365, Math.floor(options.retentionDays)));
  const cutoffIso = new Date(Date.now() - days * 86_400_000).toISOString();
  const db = getDbInstance();

  const callRes = deleteCallLogsBefore(cutoffIso, 5000);
  let deletedProxyLogs = 0;
  try {
    const info = db
      .prepare("DELETE FROM proxy_logs WHERE timestamp < ?")
      .run(cutoffIso) as { changes?: number };
    deletedProxyLogs = Number(info?.changes ?? 0);
  } catch {
    // proxy_logs table may not exist in minimal schemas
  }

  let vacuumed = false;
  if (options.vacuum) {
    try {
      db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      db.exec("VACUUM");
      const now = Date.now();
      db.prepare(
        "INSERT INTO key_value (namespace, key, value) VALUES (?, ?, ?) ON CONFLICT(namespace, key) DO UPDATE SET value = excluded.value",
      ).run("scheduler", "vacuum", JSON.stringify({ lastRunAt: now }));
      vacuumed = true;
    } catch {
      vacuumed = false;
    }
  }

  return {
    cutoffIso,
    deletedCallLogs: callRes.deletedRows,
    deletedArtifacts: callRes.deletedArtifacts,
    deletedProxyLogs,
    vacuumed,
  };
}

import { useTranslator } from "../lib/useTranslator.ts";
import { useEffect, useState } from "react";
import { Activity, DatabaseBackup, KeyRound, Plus, SlidersHorizontal, Trash2, Wrench } from "lucide-react";
import { toast } from "sonner";
import { LoadingState } from "../components/PageStates.tsx";
import { api, type JsonValue } from "../lib/api.ts";
import { useAction } from "../lib/actions.tsx";
import { when } from "../lib/format.ts";
import { useFetch } from "../lib/useFetch.ts";
import { usePreferences } from "../lib/preferences.tsx";
import { AdvancedSettings } from "../components/settings/AdvancedSettings.tsx";
import {
  EmergencyDispatchPauseSection,
  HealthAndVersionsSettings,
} from "../components/settings/HealthAndVersionsSettings.tsx";
import { TableScroll } from "../components/TableScroll.tsx";

type SettingsBag = Record<string, unknown>;
type SettingsTab = "runtime" | "security" | "backups" | "health" | "advanced";

const FALLBACK_STRATEGIES = [
  "priority",
  "weighted",
  "fill-first",
  "round-robin",
  "p2c",
  "random",
  "least-used",
  "cost-optimized",
  "strict-random",
] as const;

export function Settings() {
  const tr = useTranslator();
  const { t } = usePreferences();
  const [tab, setTab] = useState<SettingsTab>("runtime");
  const state = useFetch<SettingsBag>("/api/settings");

  return (
    <div className="page">
      <div className="section-head" style={{ marginBottom: 16 }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>{t("Settings")}</h1>
          <p className="muted" style={{ margin: 0 }}>{tr("Configure account failover policies, wildcard model aliases, management security, and SQLite snapshots.")}</p>
        </div>
      </div>

      <div className="tabs" role="tablist" aria-label={tr("Settings sections")}>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "runtime"}
          className={tab === "runtime" ? "tab active" : "tab"}
          onClick={() => setTab("runtime")}
        >
          <SlidersHorizontal size={14} />
          <span>{t("Routing & Runtime")}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "security"}
          className={tab === "security" ? "tab active" : "tab"}
          onClick={() => setTab("security")}
        >
          <KeyRound size={14} />
          <span>{t("Security")}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "backups"}
          className={tab === "backups" ? "tab active" : "tab"}
          onClick={() => setTab("backups")}
        >
          <DatabaseBackup size={14} />
          <span>{t("Database Backups")}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "health"}
          className={tab === "health" ? "tab active" : "tab"}
          onClick={() => setTab("health")}
        >
          <Activity size={14} />
          <span>{t("Health & Versions")}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "advanced"}
          className={tab === "advanced" ? "tab active" : "tab"}
          onClick={() => setTab("advanced")}
        >
          <Wrench size={14} />
          <span>{t("Advanced")}</span>
        </button>
      </div>

      {tab === "runtime" && (
        <>
          {state.status === "loading" && <LoadingState label={tr("Loading runtime settings")} />}
          {state.status === "error" && <p className="bad">{state.error.message}</p>}
          {state.status === "ok" && <RoutingAndRuntimeSettings initial={state.data} onSaved={state.reload} />}
        </>
      )}

      {tab === "security" && (
        <>
          <ChangePassword />
          <EmergencyDispatchPauseSection />
        </>
      )}

      {tab === "backups" && <DatabaseBackupsSection />}

      {tab === "health" && <HealthAndVersionsSettings />}

      {tab === "advanced" && <AdvancedSettings settings={state.status === "ok" ? state.data : {}} loading={state.status === "loading"} error={state.status === "error" ? state.error.message : undefined} />}
    </div>
  );
}

interface WildcardAlias {
  pattern: string;
  target: string;
}

export interface ProviderErrorRuleEntry {
  status: number;
  match: string;
  scope: "model" | "provider" | "connection";
  reason?: "auth_error" | "quota_exhausted" | "rate_limit_exceeded" | "model_capacity" | "server_error" | "unknown";
  cooldownMs?: number;
}

export function formatProviderErrorRulesText(
  rulesMap: unknown,
): string {
  if (!rulesMap || typeof rulesMap !== "object" || Array.isArray(rulesMap)) return "";
  const lines: string[] = [];
  for (const [provider, list] of Object.entries(rulesMap as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    for (const r of list) {
      if (!r || typeof r !== "object") continue;
      const rec = r as Record<string, unknown>;
      const status = Number(rec.status ?? 429);
      const match = String(rec.match ?? "").trim();
      const scope = String(rec.scope ?? "model");
      const reason = String(rec.reason ?? "quota_exhausted");
      const cooldownSec = rec.cooldownMs != null ? Math.round(Number(rec.cooldownMs) / 1000) : 60;
      if (provider && match) {
        lines.push(`${provider} | ${status} | ${match} | ${scope} | ${reason} | ${cooldownSec}`);
      }
    }
  }
  return lines.join("\n");
}

export function parseProviderErrorRulesText(
  text: string,
): { ok: true; rules: Record<string, ProviderErrorRuleEntry[]> } | { ok: false; error: string } {
  const rules: Record<string, ProviderErrorRuleEntry[]> = {};
  const validScopes = new Set(["model", "provider", "connection"]);
  const validReasons = new Set([
    "auth_error",
    "quota_exhausted",
    "rate_limit_exceeded",
    "model_capacity",
    "server_error",
    "unknown",
  ]);
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split("|").map((p) => p.trim());
    if (parts.length < 3) {
      return { ok: false, error: `Invalid error rule line (expected provider | status | match | scope | reason | cooldownSec): ${line}` };
    }
    const [provider, statusStr, match, scopeRaw = "model", reasonRaw = "quota_exhausted", cooldownSecStr = "60"] = parts;
    const status = Number(statusStr);
    const cooldownSec = Number(cooldownSecStr);
    if (!provider || !Number.isInteger(status) || status < 100 || status > 599 || !match) {
      return { ok: false, error: `Invalid provider/status/match in rule: ${line}` };
    }
    if (!validScopes.has(scopeRaw)) {
      return { ok: false, error: `Invalid scope "${scopeRaw}" (use model, provider, or connection)` };
    }
    if (!validReasons.has(reasonRaw)) {
      return { ok: false, error: `Invalid reason "${reasonRaw}"` };
    }
    const list = rules[provider] ?? [];
    list.push({
      status,
      match,
      scope: scopeRaw as ProviderErrorRuleEntry["scope"],
      reason: reasonRaw as ProviderErrorRuleEntry["reason"],
      cooldownMs: Number.isFinite(cooldownSec) && cooldownSec >= 0 ? Math.round(cooldownSec * 1000) : 60000,
    });
    rules[provider] = list;
  }
  return { ok: true, rules };
}

function RoutingAndRuntimeSettings({ initial, onSaved }: { initial: SettingsBag; onSaved: () => void }) {
  const tr = useTranslator();
  const { t } = usePreferences();
  const [fallbackStrategy, setFallbackStrategy] = useState<string>(String(initial.fallbackStrategy ?? "priority"));
  const [comboStrategy, setComboStrategy] = useState<string>(String(initial.comboStrategy ?? "fallback"));
  const [requestRetry, setRequestRetry] = useState<number>(Number(initial.requestRetry ?? 2));
  const [maxRetryIntervalSec, setMaxRetryIntervalSec] = useState<number>(Number(initial.maxRetryIntervalSec ?? 30));
  const [stickyLimit, setStickyLimit] = useState<number>(Number(initial.stickyRoundRobinLimit ?? 0));
  const [softQuotaFloorPercent, setSoftQuotaFloorPercent] = useState<number>(
    Number(initial.softQuotaFloorPercent ?? 0),
  );
  const [accountMinSpacingMs, setAccountMinSpacingMs] = useState<number>(
    Number(initial.accountMinSpacingMs ?? 0),
  );
  const [disableStickiness, setDisableStickiness] = useState<boolean>(Boolean(initial.disableSessionStickiness));
  const [promptCacheAffinity, setPromptCacheAffinity] = useState<boolean>(initial.promptCacheAffinityEnabled !== false);
  const [lkgpEnabled, setLkgpEnabled] = useState<boolean>(Boolean(initial.lkgpEnabled));
  const [autoRefreshQuota, setAutoRefreshQuota] = useState<boolean>(initial.autoRefreshProviderQuota !== false);
  const [hideHealthLogs, setHideHealthLogs] = useState<boolean>(Boolean(initial.hideHealthCheckLogs));
  const [debugMode, setDebugMode] = useState<boolean>(Boolean(initial.debugMode));
  const [customSystemPromptEnabled, setCustomSystemPromptEnabled] = useState<boolean>(
    Boolean(initial.customSystemPromptEnabled),
  );
  const [customSystemPrompt, setCustomSystemPrompt] = useState<string>(
    typeof initial.customSystemPrompt === "string" ? initial.customSystemPrompt : "",
  );
  const initTb = (initial.thinkingBudget && typeof initial.thinkingBudget === "object" ? initial.thinkingBudget : {}) as Record<string, unknown>;
  const [thinkingMode, setThinkingMode] = useState<string>(String(initTb.mode ?? "passthrough"));
  const [thinkingCustomBudget, setThinkingCustomBudget] = useState<number>(Number(initTb.customBudget ?? 10240));
  const [thinkingEffort, setThinkingEffort] = useState<string>(String(initTb.effortLevel ?? "medium"));

  const initCodexTier = (initial.codexServiceTier && typeof initial.codexServiceTier === "object" ? initial.codexServiceTier : {}) as Record<string, unknown>;
  const [codexTierEnabled, setCodexTierEnabled] = useState<boolean>(Boolean(initCodexTier.enabled));
  const [codexTier, setCodexTier] = useState<string>(String(initCodexTier.tier ?? "default"));

  const [visionBridgeEnabled, setVisionBridgeEnabled] = useState<boolean>(Boolean(initial.visionBridgeEnabled));
  const [visionBridgeModel, setVisionBridgeModel] = useState<string>(typeof initial.visionBridgeModel === "string" ? initial.visionBridgeModel : "");
  const [webSearchRouteModel, setWebSearchRouteModel] = useState<string>(typeof initial.webSearchRouteModel === "string" ? initial.webSearchRouteModel : "");

  const initResilience = (initial.resilienceSettings && typeof initial.resilienceSettings === "object" ? initial.resilienceSettings : {}) as Record<string, unknown>;
  const initStreamRec = (initResilience.streamRecovery && typeof initResilience.streamRecovery === "object" ? initResilience.streamRecovery : {}) as Record<string, unknown>;
  const initWatchdog = (initStreamRec.throughputWatchdog && typeof initStreamRec.throughputWatchdog === "object" ? initStreamRec.throughputWatchdog : {}) as Record<string, unknown>;
  const [streamRecoveryEnabled, setStreamRecoveryEnabled] = useState<boolean>(Boolean(initStreamRec.enabled));
  const [continueMidStream, setContinueMidStream] = useState<boolean>(Boolean(initStreamRec.continueMidStream));
  const [watchdogEnabled, setWatchdogEnabled] = useState<boolean>(Boolean(initWatchdog.enabled));

  const [errorRulesText, setErrorRulesText] = useState<string>(() => formatProviderErrorRulesText(initial.providerErrorRules));
  const [aliasesText, setAliasesText] = useState<string>(() => {
    const arr = Array.isArray(initial.wildcardAliases) ? (initial.wildcardAliases as WildcardAlias[]) : [];
    return arr.map((a) => `${a.pattern} = ${a.target}`).join("\n");
  });
  const [newPattern, setNewPattern] = useState("");
  const [newTarget, setNewTarget] = useState("");
  const [savedBanner, setSavedBanner] = useState(false);

  const parsedAliases = aliasesText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const eq = line.indexOf("=");
      return eq > 0 ? { pattern: line.slice(0, eq).trim(), target: line.slice(eq + 1).trim() } : null;
    })
    .filter((x): x is WildcardAlias => Boolean(x && x.pattern && x.target));

  function addAliasRule() {
    const p = newPattern.trim();
    const t = newTarget.trim();
    if (!p || !t) return;
    setAliasesText((cur) => (cur.trim() ? `${cur.trim()}\n${p} = ${t}` : `${p} = ${t}`));
    setNewPattern("");
    setNewTarget("");
  }

  function removeAliasRule(idx: number) {
    const next = parsedAliases.filter((_, i) => i !== idx);
    setAliasesText(next.map((a) => `${a.pattern} = ${a.target}`).join("\n"));
  }
  const { busy, error, run } = useAction(() => {
    setSavedBanner(true);
    toast.success("Runtime settings saved");
    onSaved();
  });

  useEffect(() => {
    setFallbackStrategy(String(initial.fallbackStrategy ?? "priority"));
    setComboStrategy(String(initial.comboStrategy ?? "fallback"));
    setRequestRetry(Number(initial.requestRetry ?? 2));
    setMaxRetryIntervalSec(Number(initial.maxRetryIntervalSec ?? 30));
    setStickyLimit(Number(initial.stickyRoundRobinLimit ?? 0));
    setSoftQuotaFloorPercent(Number(initial.softQuotaFloorPercent ?? 0));
    setAccountMinSpacingMs(Number(initial.accountMinSpacingMs ?? 0));
    setDisableStickiness(Boolean(initial.disableSessionStickiness));
    setPromptCacheAffinity(initial.promptCacheAffinityEnabled !== false);
    setLkgpEnabled(Boolean(initial.lkgpEnabled));
    setAutoRefreshQuota(initial.autoRefreshProviderQuota !== false);
    setHideHealthLogs(Boolean(initial.hideHealthCheckLogs));
    setDebugMode(Boolean(initial.debugMode));
    setCustomSystemPromptEnabled(Boolean(initial.customSystemPromptEnabled));
    setCustomSystemPrompt(typeof initial.customSystemPrompt === "string" ? initial.customSystemPrompt : "");
    const tb = (initial.thinkingBudget && typeof initial.thinkingBudget === "object" ? initial.thinkingBudget : {}) as Record<string, unknown>;
    setThinkingMode(String(tb.mode ?? "passthrough"));
    setThinkingCustomBudget(Number(tb.customBudget ?? 10240));
    setThinkingEffort(String(tb.effortLevel ?? "medium"));
    const ct = (initial.codexServiceTier && typeof initial.codexServiceTier === "object" ? initial.codexServiceTier : {}) as Record<string, unknown>;
    setCodexTierEnabled(Boolean(ct.enabled));
    setCodexTier(String(ct.tier ?? "default"));
    setVisionBridgeEnabled(Boolean(initial.visionBridgeEnabled));
    setVisionBridgeModel(typeof initial.visionBridgeModel === "string" ? initial.visionBridgeModel : "");
    setWebSearchRouteModel(typeof initial.webSearchRouteModel === "string" ? initial.webSearchRouteModel : "");
    const rs = (initial.resilienceSettings && typeof initial.resilienceSettings === "object" ? initial.resilienceSettings : {}) as Record<string, unknown>;
    const sr = (rs.streamRecovery && typeof rs.streamRecovery === "object" ? rs.streamRecovery : {}) as Record<string, unknown>;
    const wd = (sr.throughputWatchdog && typeof sr.throughputWatchdog === "object" ? sr.throughputWatchdog : {}) as Record<string, unknown>;
    setStreamRecoveryEnabled(Boolean(sr.enabled));
    setContinueMidStream(Boolean(sr.continueMidStream));
    setWatchdogEnabled(Boolean(wd.enabled));
    setErrorRulesText(formatProviderErrorRulesText(initial.providerErrorRules));
    const arr = Array.isArray(initial.wildcardAliases) ? (initial.wildcardAliases as WildcardAlias[]) : [];
    setAliasesText(arr.map((a) => `${a.pattern} = ${a.target}`).join("\n"));
  }, [initial]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSavedBanner(false);
    const wildcardAliases: { pattern: string; target: string }[] = [];
    for (const raw of aliasesText.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      const eq = line.indexOf("=");
      if (eq <= 0 || !line.slice(eq + 1).trim()) { toast.error(t("Invalid alias rule") + ": " + line); return; }
      const pattern = line.slice(0, eq).trim();
      const target = line.slice(eq + 1).trim();
      if (pattern && target) wildcardAliases.push({ pattern, target });
    }
    const parsedErrorRules = parseProviderErrorRulesText(errorRulesText);
    if (parsedErrorRules.ok === false) {
      toast.error(parsedErrorRules.error);
      return;
    }
    const existingResilience =
      initial.resilienceSettings && typeof initial.resilienceSettings === "object" && !Array.isArray(initial.resilienceSettings)
        ? (initial.resilienceSettings as Record<string, JsonValue>)
        : {};
    const existingStreamRecovery =
      existingResilience.streamRecovery && typeof existingResilience.streamRecovery === "object" && !Array.isArray(existingResilience.streamRecovery)
        ? (existingResilience.streamRecovery as Record<string, JsonValue>)
        : {};
    const existingWatchdog =
      existingStreamRecovery.throughputWatchdog && typeof existingStreamRecovery.throughputWatchdog === "object" && !Array.isArray(existingStreamRecovery.throughputWatchdog)
        ? (existingStreamRecovery.throughputWatchdog as Record<string, JsonValue>)
        : {};

    const payload: Record<string, JsonValue> = {
      fallbackStrategy,
      comboStrategy,
      requestRetry: Math.max(0, Math.min(10, Math.round(requestRetry))),
      maxRetryIntervalSec: Math.max(0, Math.min(300, Math.round(maxRetryIntervalSec))),
      stickyRoundRobinLimit: Math.max(0, Math.min(1000, Math.round(stickyLimit))),
      softQuotaFloorPercent: Math.max(0, Math.min(50, Math.round(softQuotaFloorPercent))),
      accountMinSpacingMs: Math.max(0, Math.min(60000, Math.round(accountMinSpacingMs))),
      disableSessionStickiness: disableStickiness,
      promptCacheAffinityEnabled: promptCacheAffinity,
      lkgpEnabled,
      autoRefreshProviderQuota: autoRefreshQuota,
      hideHealthCheckLogs: hideHealthLogs,
      debugMode,
      customSystemPromptEnabled,
      customSystemPrompt,
      thinkingBudget: {
        mode: thinkingMode,
        customBudget: Math.max(0, Math.min(1_000_000, Math.round(thinkingCustomBudget))),
        effortLevel: thinkingEffort,
      },
      codexServiceTier: {
        enabled: codexTierEnabled,
        tier: codexTier,
      },
      visionBridgeEnabled,
      visionBridgeModel: visionBridgeModel.trim(),
      webSearchRouteModel: webSearchRouteModel.trim(),
      providerErrorRules: parsedErrorRules.rules as unknown as JsonValue,
      resilienceSettings: {
        ...existingResilience,
        streamRecovery: {
          ...existingStreamRecovery,
          enabled: streamRecoveryEnabled,
          continueMidStream,
          throughputWatchdog: {
            ...existingWatchdog,
            enabled: watchdogEnabled,
          },
        },
      },
      wildcardAliases,
    };
    await run("save-settings", () => api.patch("/api/settings", payload));
  }

  return (
    <section className="settings-card">
      <form className="stack-form" onSubmit={submit}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))", gap: 24, alignItems: "start" }}>
          <div style={{ display: "grid", gap: 14 }}>
            <h2 style={{ margin: 0 }}>{t("Failover & retry behavior")}</h2>
            <div className="two-col" style={{ gap: 12 }}>
              <label>
                {t("Account fallback strategy")}
                <select value={fallbackStrategy} onChange={(e) => setFallbackStrategy(e.target.value)}>
                  {FALLBACK_STRATEGIES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t("Combo expansion strategy")}
                <select value={comboStrategy} onChange={(e) => setComboStrategy(e.target.value)}>
                  <option value="fallback">fallback (in order)</option>
                  <option value="round-robin">round-robin</option>
                </select>
              </label>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, alignItems: "end" }}>
              <label>
                {t("Request retries (0\u201310)")}
                <input
                  type="number"
                  min={0}
                  max={10}
                  value={requestRetry}
                  onChange={(e) => setRequestRetry(Number(e.target.value))}
                />
              </label>
              <label>
                {t("Max retry sec (0\u2013300)")}
                <input
                  type="number"
                  min={0}
                  max={300}
                  value={maxRetryIntervalSec}
                  onChange={(e) => setMaxRetryIntervalSec(Number(e.target.value))}
                />
              </label>
              <label>
                {t("Sticky limit (0 = off)")}
                <input
                  type="number"
                  min={0}
                  max={1000}
                  value={stickyLimit}
                  onChange={(e) => setStickyLimit(Number(e.target.value))}
                />
              </label>
            </div>
            <div className="two-col" style={{ gap: 12 }}>
              <label>
                {tr("Soft quota floor % (0\u201350)")}
                <input
                  type="number"
                  min={0}
                  max={50}
                  value={softQuotaFloorPercent}
                  onChange={(e) => setSoftQuotaFloorPercent(Number(e.target.value))}
                />
              </label>
              <label>
                {tr("Min account pacing ms (0\u201360000)")}
                <input
                  type="number"
                  min={0}
                  max={60000}
                  step={100}
                  value={accountMinSpacingMs}
                  onChange={(e) => setAccountMinSpacingMs(Number(e.target.value))}
                />
              </label>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "10px 16px", paddingTop: 4 }}>
              <label className="check">
                <input type="checkbox" checked={promptCacheAffinity} onChange={(e) => setPromptCacheAffinity(e.target.checked)} />
                <span>{tr("Keep combo targets close to provider prompt cache")}</span>
              </label>
              <label className="check">
                <input type="checkbox" checked={disableStickiness} onChange={(e) => setDisableStickiness(e.target.checked)} />
                <span>{tr("Disable session stickiness globally")}</span>
              </label>
              <label className="check">
                <input type="checkbox" checked={lkgpEnabled} onChange={(e) => setLkgpEnabled(e.target.checked)} />
                <span>{tr("Enable Last Known Good Provider (LKGP) memory")}</span>
              </label>
              <label className="check">
                <input type="checkbox" checked={autoRefreshQuota} onChange={(e) => setAutoRefreshQuota(e.target.checked)} />
                <span>{tr("Auto-refresh provider quota in background")}</span>
              </label>
              <label className="check">
                <input type="checkbox" checked={hideHealthLogs} onChange={(e) => setHideHealthLogs(e.target.checked)} />
                <span>{tr("Hide health-check requests from call logs")}</span>
              </label>
              <label className="check">
                <input type="checkbox" checked={debugMode} onChange={(e) => setDebugMode(e.target.checked)} />
                <span>{tr("Debug logging mode")}</span>
              </label>
              <label className="check">
                <input type="checkbox" checked={streamRecoveryEnabled} onChange={(e) => setStreamRecoveryEnabled(e.target.checked)} />
                <span>{tr("Enable stream recovery (transparent early retry)")}</span>
              </label>
              <label className="check">
                <input type="checkbox" checked={continueMidStream} onChange={(e) => setContinueMidStream(e.target.checked)} />
                <span>{tr("Continue mid-stream after unexpected disconnect")}</span>
              </label>
              <label className="check">
                <input type="checkbox" checked={watchdogEnabled} onChange={(e) => setWatchdogEnabled(e.target.checked)} />
                <span>{tr("Enable stream throughput watchdog")}</span>
              </label>
            </div>

            <h2 style={{ margin: "10px 0 0 0" }}>{tr("Thinking Budget & Codex Tier")}</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, alignItems: "end" }}>
              <label>
                {tr("Thinking mode")}
                <select value={thinkingMode} onChange={(e) => setThinkingMode(e.target.value)}>
                  <option value="passthrough">passthrough</option>
                  <option value="auto">auto (strip)</option>
                  <option value="custom">custom budget</option>
                  <option value="adaptive">adaptive effort</option>
                </select>
              </label>
              <label>
                {tr("Custom budget tokens")}
                <input
                  type="number"
                  min={0}
                  max={1000000}
                  step={1024}
                  value={thinkingCustomBudget}
                  onChange={(e) => setThinkingCustomBudget(Number(e.target.value))}
                />
              </label>
              <label>
                {tr("Effort level")}
                <select value={thinkingEffort} onChange={(e) => setThinkingEffort(e.target.value)}>
                  {["none", "low", "medium", "high", "max"].map((lvl) => (
                    <option key={lvl} value={lvl}>
                      {lvl}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="two-col" style={{ gap: 12, alignItems: "end" }}>
              <label className="check">
                <input type="checkbox" checked={codexTierEnabled} onChange={(e) => setCodexTierEnabled(e.target.checked)} />
                <span>{tr("Override Codex service tier")}</span>
              </label>
              <label>
                {tr("Codex tier")}
                <select value={codexTier} onChange={(e) => setCodexTier(e.target.value)} disabled={!codexTierEnabled}>
                  <option value="default">default</option>
                  <option value="priority">priority</option>
                  <option value="flex">flex</option>
                </select>
              </label>
            </div>

            <h2 style={{ margin: "10px 0 0 0" }}>{tr("Vision Bridge & Web-Search Router")}</h2>
            <label className="check">
              <input type="checkbox" checked={visionBridgeEnabled} onChange={(e) => setVisionBridgeEnabled(e.target.checked)} />
              <span>{tr("Enable Vision Bridge (describe images for text-only models)")}</span>
            </label>
            <div className="two-col" style={{ gap: 12 }}>
              <label>
                {tr("Vision Bridge model")}
                <input
                  type="text"
                  placeholder="antigravity/gemini-3-flash"
                  value={visionBridgeModel}
                  onChange={(e) => setVisionBridgeModel(e.target.value)}
                />
              </label>
              <label>
                {tr("Web-search route model")}
                <input
                  type="text"
                  placeholder="antigravity/gemini-3-flash"
                  value={webSearchRouteModel}
                  onChange={(e) => setWebSearchRouteModel(e.target.value)}
                />
              </label>
            </div>
          </div>

          <div style={{ display: "grid", gap: 10 }}>
            <h2 style={{ margin: 0 }}>{t("Wildcard model aliases")}</h2>
            <p className="muted" style={{ margin: 0, fontSize: 14 }}>{tr("Redirect matching model patterns to a canonical")}<code>provider/model</code>{tr("target before dispatch.")}</p>
            {parsedAliases.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {parsedAliases.map((a, idx) => (
                  <span
                    key={`${a.pattern}-${idx}`}
                    className="vendor-badge"
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 8px" }}
                  >
                    <code>{a.pattern}</code>
                    <span className="muted">→</span>
                    <code>{a.target}</code>
                    <button
                      type="button"
                      aria-label={tr("Remove alias {0}", {0: String(a.pattern)})}
                      onClick={() => removeAliasRule(idx)}
                      style={{
                        background: "transparent",
                        border: "none",
                        color: "var(--muted)",
                        padding: 0,
                        cursor: "pointer",
                        display: "inline-flex",
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="settings-alias-builder">
              <input
                type="text"
                placeholder={tr("Pattern")} aria-label={tr("Alias pattern")}
                value={newPattern}
                onChange={(e) => setNewPattern(e.target.value)}
                style={{ minWidth: 0 }}
              />
              <input
                type="text"
                placeholder="provider/model" aria-label={tr("Alias target")}
                value={newTarget}
                onChange={(e) => setNewTarget(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addAliasRule();
                  }
                }}
                style={{ minWidth: 0 }}
              />
              <button
                type="button"
                className="btn-ghost"
                style={{ whiteSpace: "nowrap" }}
                disabled={!newPattern.trim() || !newTarget.trim()}
                onClick={addAliasRule}
              >
                <Plus size={14} />
                <span>{t("Add rule")}</span>
              </button>
            </div>
            <label>
              <span className="muted" style={{ fontSize: 14 }}>{tr("Raw rules — one per line (")}<code>pattern = provider/model</code>)
              </span>
              <textarea
                rows={4}
                value={aliasesText}
                onChange={(e) => setAliasesText(e.target.value)}
                placeholder={"gpt-4o* = codex/gpt-5.3-codex\nclaude-sonnet* = antigravity/claude-sonnet-4-6"}
              />
            </label>

            <h2 style={{ margin: "10px 0 0 0" }}>{t("Custom persona / Soul prompt")}</h2>
            <p className="muted" style={{ margin: 0, fontSize: 14 }}>
              {tr("Optionally inject a custom system prompt or persona across inbound requests before upstream dispatch.")}
            </p>
            <label className="check">
              <input
                type="checkbox"
                checked={customSystemPromptEnabled}
                onChange={(e) => setCustomSystemPromptEnabled(e.target.checked)}
              />
              <span>{tr("Enable custom system prompt injection")}</span>
            </label>
            <label>
              <span className="muted" style={{ fontSize: 14 }}>{tr("System prompt text (max 10,000 chars)")}</span>
              <textarea
                rows={4}
                maxLength={10000}
                value={customSystemPrompt}
                onChange={(e) => setCustomSystemPrompt(e.target.value)}
                placeholder={tr("Enter custom system prompt or persona instructions…")}
              />
            </label>

            <h2 style={{ margin: "10px 0 0 0" }}>{tr("Custom Provider Error Rules")}</h2>
            <p className="muted" style={{ margin: 0, fontSize: 14 }}>
              {tr("Override cooldown classification per provider — one rule per line:")}{" "}
              <code>provider | status | substring | scope | reason | cooldownSec</code>
            </p>
            <label>
              <textarea
                rows={4}
                aria-label={tr("Custom provider error rules")}
                value={errorRulesText}
                onChange={(e) => setErrorRulesText(e.target.value)}
                placeholder={"codebuddy-cn | 400 | 6000 | model | quota_exhausted | 300\nglm | 429 | rate limit | connection | rate_limit_exceeded | 60"}
              />
            </label>
          </div>
        </div>
        {error && <div className="bad">{error}</div>}
        {savedBanner && <div className="ok">{tr("Settings saved.")}</div>}
        <div style={{ paddingTop: 4, borderTop: "1px solid var(--border-subtle)" }}>
          <button type="submit" className="btn-add" disabled={busy !== null}>
            {busy === "save-settings" ? "…" : "Save settings"}
          </button>
        </div>
      </form>
    </section>
  );
}

function ChangePassword() {
  const tr = useTranslator();
  const { t } = usePreferences();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [done, setDone] = useState(false);
  const { busy, error, run, clearError } = useAction();
  const mismatch = again.length > 0 && next !== again;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setDone(false);
    clearError();
    const out = await run("password", () => api.post("/api/auth/password", { currentPassword: current, newPassword: next }));
    if (out) {
      setDone(true);
      setCurrent("");
      setNext("");
      setAgain("");
      toast.success("Management password updated");
    }
  }

  return (
    <section className="settings-card">
      <h2>{t("Management password")}</h2>
      <p className="muted">{tr("Used to sign in here. At least 12 characters. Other signed-in browsers stay signed in until their session expires.")}</p>
      <form className="stack-form" onSubmit={submit}>
        <input type="password" autoComplete="current-password" placeholder={tr("Current password")} value={current} onChange={(e) => setCurrent(e.target.value)} required />
        <input type="password" autoComplete="new-password" placeholder={tr("New password (12+ characters)")} minLength={12} value={next} onChange={(e) => setNext(e.target.value)} required />
        <input type="password" autoComplete="new-password" placeholder={tr("Repeat new password")} value={again} onChange={(e) => setAgain(e.target.value)} required />
        {mismatch && <div className="bad">{tr("The two new passwords differ.")}</div>}
        {error && <div className="bad">{error}</div>}
        {done && <div className="ok">{tr("Password changed.")}</div>}
        <div>
          <button type="submit" className="btn-add" disabled={busy !== null || mismatch || next.length < 12 || !current}>
            {busy ? "…" : "Change password"}
          </button>
        </div>
      </form>
    </section>
  );
}

interface BackupRow {
  id: string;
  filename: string;
  createdAt: string;
  size: number;
  reason: string;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function DatabaseBackupsSection() {
  const tr = useTranslator();
  const { t } = usePreferences();
  const state = useFetch<{ backups?: BackupRow[] }>("/api/backups");
  const rows = state.status === "ok" ? state.data.backups ?? [] : [];
  const { busy, error, run } = useAction(state.reload);
  const [retentionDays, setRetentionDays] = useState(14);

  async function createSnapshot() {
    const out = await run("backup", () => api.post<{ filename: string; size: number }>("/api/backups"));
    if (out) {
      toast.success(`Created backup ${out.filename} (${formatBytes(out.size)})`);
    }
  }

  async function pruneLogsAndVacuum() {
    const out = await run("prune", () =>
      api.post<{ deletedCallLogs: number; deletedProxyLogs: number; vacuumed: boolean }>("/api/storage/prune", {
        retentionDays,
        vacuum: true,
      }),
    );
    if (out) {
      toast.success(
        `Pruned ${out.deletedCallLogs} call logs & ${out.deletedProxyLogs} proxy logs${out.vacuumed ? " + VACUUM completed" : ""}`,
      );
    }
  }

  return (
    <section className="settings-card">
      <div className="section-head" style={{ marginBottom: 12 }}>
        <div>
          <h2 style={{ marginBottom: 4 }}>{t("Database Backups")}</h2>
          <p className="muted" style={{ margin: 0 }}>{tr("Consistent online SQLite snapshots stored in")}<code>db_backups/</code>{tr(". Scheduled snapshots run daily and prune older copies automatically.")}</p>
        </div>
        <button type="button" className="btn-add" disabled={busy !== null} onClick={createSnapshot}>
          <DatabaseBackup size={14} />
          <span>{busy === "backup" ? "Snapshotting…" : "Backup now"}</span>
        </button>
      </div>

      {error && <p className="bad">{error}</p>}
      {state.status === "loading" && <LoadingState label={tr("Loading database backups")} />}
      {state.status === "error" && <p className="bad">{state.error.message}</p>}
      {state.status === "ok" && rows.length === 0 && (
        <p className="muted">{tr("No backups recorded yet. Click “Backup now” to take an immediate snapshot.")}</p>
      )}
      {state.status === "ok" && rows.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <TableScroll label={t("Database backups table")} stickyPrimary>
          <table className="table">
            <thead>
              <tr>
                <th>{t("Filename")}</th>
                <th>{t("Reason")}</th>
                <th>{t("Size")}</th>
                <th>{t("Created")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id}>
                  <td>
                    <code>{b.filename}</code>
                  </td>
                  <td>
                    <span className="vendor-badge">{b.reason}</span>
                  </td>
                  <td>{formatBytes(b.size)}</td>
                  <td className="muted">{when(b.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </TableScroll>
        </div>
      )}

      <div className="card" style={{ padding: 14, marginTop: 16 }}>
        <div className="section-head" style={{ marginBottom: 8 }}>
          <div>
            <strong style={{ fontSize: 15 }}>{tr("Telemetry log retention & SQLite VACUUM")}</strong>
            <p className="muted" style={{ margin: "2px 0 0 0", fontSize: 14 }}>
              {tr("Prune raw call_logs and proxy_logs older than the selected retention window and compact SQLite WAL/pages.")}
            </p>
          </div>
          <div className="row-actions" style={{ gap: 8 }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 14 }}>
              <span>{tr("Keep")}</span>
              <select
                aria-label={tr("Log retention days")}
                value={retentionDays}
                onChange={(e) => setRetentionDays(Number(e.target.value))}
                disabled={busy !== null}
              >
                {[3, 7, 14, 30, 60, 90].map((d) => (
                  <option key={d} value={d}>
                    {d} {tr("days")}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn-ghost" disabled={busy !== null} onClick={pruneLogsAndVacuum}>
              <Trash2 size={14} />
              <span>{busy === "prune" ? "Pruning…" : tr("Prune logs & VACUUM")}</span>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}


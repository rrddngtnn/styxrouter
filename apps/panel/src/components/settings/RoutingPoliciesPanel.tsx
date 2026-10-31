import { useEffect, useState } from "react";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { LoadingState } from "../PageStates.tsx";
import { TableScroll } from "../TableScroll.tsx";
import { api, type JsonValue } from "../../lib/api.ts";
import { useAction } from "../../lib/actions.tsx";
import { when } from "../../lib/format.ts";
import { useFetch } from "../../lib/useFetch.ts";
import { usePreferences } from "../../lib/preferences.tsx";
import { useTranslator } from "../../lib/useTranslator.ts";
import {
  OutboundProxyConfigSection,
  type RoutingTracePayload,
} from "./HealthAndVersionsSettings.tsx";
import {
  formatProviderErrorRulesText,
  parseProviderErrorRulesText,
} from "../../pages/Settings.tsx";

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

interface WildcardAlias {
  pattern: string;
  target: string;
}

export function RoutingPoliciesPanel() {
  const tr = useTranslator();
  const state = useFetch<Record<string, unknown>>("/api/settings");
  if (state.status === "loading") return <LoadingState label={tr("Loading routing policies")} />;
  if (state.status === "error") return <p className="bad">{state.error.message}</p>;
  return <RoutingPoliciesForm initial={state.data ?? {}} onSaved={state.reload} />;
}

export function RoutingPoliciesForm({
  initial,
  onSaved,
}: {
  initial: Record<string, unknown>;
  onSaved: () => void;
}) {
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

  const initResilience = (
    initial.resilienceSettings && typeof initial.resilienceSettings === "object"
      ? initial.resilienceSettings
      : {}
  ) as Record<string, unknown>;
  const initStreamRec = (
    initResilience.streamRecovery && typeof initResilience.streamRecovery === "object"
      ? initResilience.streamRecovery
      : {}
  ) as Record<string, unknown>;
  const initWatchdog = (
    initStreamRec.throughputWatchdog && typeof initStreamRec.throughputWatchdog === "object"
      ? initStreamRec.throughputWatchdog
      : {}
  ) as Record<string, unknown>;
  const [streamRecoveryEnabled, setStreamRecoveryEnabled] = useState<boolean>(Boolean(initStreamRec.enabled));
  const [continueMidStream, setContinueMidStream] = useState<boolean>(Boolean(initStreamRec.continueMidStream));
  const [watchdogEnabled, setWatchdogEnabled] = useState<boolean>(Boolean(initWatchdog.enabled));

  const [aliasesText, setAliasesText] = useState<string>(() => {
    const arr = Array.isArray(initial.wildcardAliases) ? (initial.wildcardAliases as WildcardAlias[]) : [];
    return arr.map((a) => `${a.pattern} = ${a.target}`).join("\n");
  });
  const [newPattern, setNewPattern] = useState("");
  const [newTarget, setNewTarget] = useState("");

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
    const tgt = newTarget.trim();
    if (!p || !tgt) return;
    setAliasesText((cur) => (cur.trim() ? `${cur.trim()}\n${p} = ${tgt}` : `${p} = ${tgt}`));
    setNewPattern("");
    setNewTarget("");
  }

  function removeAliasRule(idx: number) {
    const next = parsedAliases.filter((_, i) => i !== idx);
    setAliasesText(next.map((a) => `${a.pattern} = ${a.target}`).join("\n"));
  }

  const { busy, error, run } = useAction(() => {
    toast.success(tr("Routing policies & aliases saved"));
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
    const rs = (initial.resilienceSettings && typeof initial.resilienceSettings === "object" ? initial.resilienceSettings : {}) as Record<string, unknown>;
    const sr = (rs.streamRecovery && typeof rs.streamRecovery === "object" ? rs.streamRecovery : {}) as Record<string, unknown>;
    const wd = (sr.throughputWatchdog && typeof sr.throughputWatchdog === "object" ? sr.throughputWatchdog : {}) as Record<string, unknown>;
    setStreamRecoveryEnabled(Boolean(sr.enabled));
    setContinueMidStream(Boolean(sr.continueMidStream));
    setWatchdogEnabled(Boolean(wd.enabled));
    const arr = Array.isArray(initial.wildcardAliases) ? (initial.wildcardAliases as WildcardAlias[]) : [];
    setAliasesText(arr.map((a) => `${a.pattern} = ${a.target}`).join("\n"));
  }, [initial]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const wildcardAliases: { pattern: string; target: string }[] = [];
    for (const raw of aliasesText.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      const eq = line.indexOf("=");
      if (eq <= 0 || !line.slice(eq + 1).trim()) {
        toast.error(t("Invalid alias rule") + ": " + line);
        return;
      }
      wildcardAliases.push({
        pattern: line.slice(0, eq).trim(),
        target: line.slice(eq + 1).trim(),
      });
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

    await run("save", () =>
      api.patch("/api/settings", {
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
      }),
    );
  }

  return (
    <section className="settings-card">
      <form className="stack-form" onSubmit={submit}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))", gap: 24, alignItems: "start" }}>
          <div style={{ display: "grid", gap: 14 }}>
            <h2 style={{ margin: 0 }}>{t("Failover, Pacing & Stream Recovery")}</h2>
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
                {t("Request retries (0–10)")}
                <input type="number" min={0} max={10} value={requestRetry} onChange={(e) => setRequestRetry(Number(e.target.value))} />
              </label>
              <label>
                {t("Max retry sec (0–300)")}
                <input type="number" min={0} max={300} value={maxRetryIntervalSec} onChange={(e) => setMaxRetryIntervalSec(Number(e.target.value))} />
              </label>
              <label>
                {t("Sticky limit (0 = off)")}
                <input type="number" min={0} max={1000} value={stickyLimit} onChange={(e) => setStickyLimit(Number(e.target.value))} />
              </label>
            </div>
            <div className="two-col" style={{ gap: 12 }}>
              <label>
                {tr("Soft quota floor % (0–50)")}
                <input type="number" min={0} max={50} value={softQuotaFloorPercent} onChange={(e) => setSoftQuotaFloorPercent(Number(e.target.value))} />
              </label>
              <label>
                {tr("Min account pacing ms (0–60000)")}
                <input type="number" min={0} max={60000} step={100} value={accountMinSpacingMs} onChange={(e) => setAccountMinSpacingMs(Number(e.target.value))} />
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
              <label className="check">
                <input type="checkbox" checked={hideHealthLogs} onChange={(e) => setHideHealthLogs(e.target.checked)} />
                <span>{tr("Hide health-check requests from call logs")}</span>
              </label>
              <label className="check">
                <input type="checkbox" checked={debugMode} onChange={(e) => setDebugMode(e.target.checked)} />
                <span>{tr("Debug logging mode")}</span>
              </label>
            </div>
          </div>

          <div style={{ display: "grid", gap: 10 }}>
            <h2 style={{ margin: 0 }}>{t("Wildcard model aliases")}</h2>
            <p className="muted" style={{ margin: 0, fontSize: 14 }}>
              {tr("Redirect matching model patterns to a canonical")} <code>provider/model</code> {tr("target before dispatch.")}
            </p>
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
                      aria-label={tr("Remove alias {0}", { 0: String(a.pattern) })}
                      onClick={() => removeAliasRule(idx)}
                      style={{ background: "transparent", border: "none", color: "var(--muted)", padding: 0, cursor: "pointer", display: "inline-flex" }}
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
                placeholder={tr("Pattern (e.g. gpt-4o*)")}
                aria-label={tr("Alias pattern")}
                value={newPattern}
                onChange={(e) => setNewPattern(e.target.value)}
                style={{ minWidth: 0 }}
              />
              <input
                type="text"
                placeholder="provider/model"
                aria-label={tr("Alias target")}
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
              <span className="muted" style={{ fontSize: 14 }}>
                {tr("Raw rules — one per line (")}<code>pattern = provider/model</code>)
              </span>
              <textarea
                rows={5}
                value={aliasesText}
                onChange={(e) => setAliasesText(e.target.value)}
                placeholder={"gpt-4o* = codex/gpt-5.3-codex\nclaude-sonnet* = antigravity/claude-sonnet-4-6"}
              />
            </label>
          </div>
        </div>
        {error && <div className="bad">{error}</div>}
        <div style={{ paddingTop: 8, borderTop: "1px solid var(--border-subtle)" }}>
          <button type="submit" className="btn-add" disabled={busy !== null}>
            {busy ? "…" : tr("Save routing policies")}
          </button>
        </div>
      </form>
    </section>
  );
}

export function RoutingDecisionTracePanel() {
  const tr = useTranslator();
  const trace = useFetch<RoutingTracePayload>("/api/routing/trace");
  const [reasonFilter, setReasonFilter] = useState("all");
  const [busy, setBusy] = useState(false);

  const allEvents = (trace.status === "ok" ? trace.data.events ?? [] : []).slice().reverse();
  const reasons = [...new Set(allEvents.map((e) => e.reason))].sort();
  const filtered = allEvents
    .filter((e) => reasonFilter === "all" || e.reason === reasonFilter)
    .slice(0, 100);

  async function clearLocks() {
    setBusy(true);
    try {
      const res = await api.post<{ cleared: number }>("/api/process-health/clear-model-locks");
      toast.success(`Cleared ${res.cleared} in-memory model lock(s)`);
      trace.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-card">
      <div className="section-head" style={{ marginBottom: 12 }}>
        <div>
          <h2 style={{ marginBottom: 4 }}>{tr("Live Routing Decision Trace")}</h2>
          <p className="muted" style={{ margin: 0 }}>
            {tr("Inspect real-time candidate selection, cooldown skips, quota policy filters, and model lockouts across requests.")}
          </p>
        </div>
        <div className="row-actions" style={{ gap: 8, flexWrap: "wrap" }}>
          <select
            aria-label={tr("Filter trace by reason")}
            value={reasonFilter}
            onChange={(e) => setReasonFilter(e.target.value)}
          >
            <option value="all">{tr("All reasons")} ({allEvents.length})</option>
            {reasons.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <button type="button" className="btn-ghost" disabled={busy} onClick={clearLocks}>
            <span>{tr("Clear all process model locks")}</span>
          </button>
          <button type="button" className="btn-ghost" onClick={trace.reload}>
            <RefreshCw size={14} />
            <span>{tr("Refresh")}</span>
          </button>
        </div>
      </div>

      {trace.status === "loading" && <LoadingState label={tr("Loading routing decision trace")} />}
      {trace.status === "ok" && filtered.length === 0 && (
        <p className="muted" style={{ margin: 0 }}>{tr("No routing trace events recorded matching this filter.")}</p>
      )}
      {trace.status === "ok" && filtered.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <TableScroll label={tr("Routing decision trace table")} stickyPrimary>
            <table className="table">
              <thead>
                <tr>
                  <th>{tr("Time")}</th>
                  <th>{tr("Kind")}</th>
                  <th>{tr("Reason")}</th>
                  <th>{tr("Status")}</th>
                  <th>{tr("Cooldown")}</th>
                  <th>{tr("Request ID")}</th>
                  <th>{tr("Provider / Account")}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((ev, idx) => (
                  <tr key={`${ev.time}-${idx}`}>
                    <td className="muted">{when(new Date(ev.time).toISOString())}</td>
                    <td>
                      <span className="vendor-badge">{ev.kind}</span>
                    </td>
                    <td>
                      <code>{ev.reason}</code>
                    </td>
                    <td>{ev.status ?? "—"}</td>
                    <td>{ev.cooldownMs != null ? `${Math.round(ev.cooldownMs / 1000)}s` : "—"}</td>
                    <td>
                      <code>{ev.requestId ?? "—"}</code>
                    </td>
                    <td>
                      <code>
                        {ev.provider.slice(0, 8)} / {ev.account.slice(0, 8)}
                      </code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </div>
      )}
    </section>
  );
}

export function ModelDefaultsPanel() {
  const tr = useTranslator();
  const state = useFetch<Record<string, unknown>>("/api/settings");
  const initial = state.status === "ok" ? state.data : {};

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

  const [customSystemPromptEnabled, setCustomSystemPromptEnabled] = useState<boolean>(Boolean(initial.customSystemPromptEnabled));
  const [customSystemPrompt, setCustomSystemPrompt] = useState<string>(typeof initial.customSystemPrompt === "string" ? initial.customSystemPrompt : "");

  useEffect(() => {
    if (state.status !== "ok") return;
    const tb = (state.data.thinkingBudget && typeof state.data.thinkingBudget === "object" ? state.data.thinkingBudget : {}) as Record<string, unknown>;
    setThinkingMode(String(tb.mode ?? "passthrough"));
    setThinkingCustomBudget(Number(tb.customBudget ?? 10240));
    setThinkingEffort(String(tb.effortLevel ?? "medium"));
    const ct = (state.data.codexServiceTier && typeof state.data.codexServiceTier === "object" ? state.data.codexServiceTier : {}) as Record<string, unknown>;
    setCodexTierEnabled(Boolean(ct.enabled));
    setCodexTier(String(ct.tier ?? "default"));
    setVisionBridgeEnabled(Boolean(state.data.visionBridgeEnabled));
    setVisionBridgeModel(typeof state.data.visionBridgeModel === "string" ? state.data.visionBridgeModel : "");
    setWebSearchRouteModel(typeof state.data.webSearchRouteModel === "string" ? state.data.webSearchRouteModel : "");
    setCustomSystemPromptEnabled(Boolean(state.data.customSystemPromptEnabled));
    setCustomSystemPrompt(typeof state.data.customSystemPrompt === "string" ? state.data.customSystemPrompt : "");
  }, [state.status, state.data]);

  const { busy, error, run } = useAction(() => {
    toast.success(tr("AI & modality defaults saved"));
    state.reload();
  });

  if (state.status === "loading") return <LoadingState label={tr("Loading AI & modality defaults")} />;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    await run("save-ai", () =>
      api.patch("/api/settings", {
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
        customSystemPromptEnabled,
        customSystemPrompt,
      }),
    );
  }

  return (
    <section className="settings-card">
      <form className="stack-form" onSubmit={save}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))", gap: 24, alignItems: "start" }}>
          <div style={{ display: "grid", gap: 14 }}>
            <h2 style={{ margin: 0 }}>{tr("Thinking Budget & Codex Service Tier")}</h2>
            <p className="muted" style={{ margin: 0, fontSize: 14 }}>
              {tr("Control how reasoning budgets and effort levels are normalized across Claude, Gemini Argon, GLM, and Codex.")}
            </p>
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

          <div style={{ display: "grid", gap: 12 }}>
            <h2 style={{ margin: 0 }}>{tr("Custom Persona / Soul Prompt")}</h2>
            <p className="muted" style={{ margin: 0, fontSize: 14 }}>
              {tr("Optionally prepend a custom system instruction or persona to inbound requests when none is present.")}
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
                rows={6}
                maxLength={10000}
                value={customSystemPrompt}
                onChange={(e) => setCustomSystemPrompt(e.target.value)}
                placeholder={tr("Enter custom system prompt or persona instructions…")}
              />
            </label>
          </div>
        </div>
        {error && <div className="bad">{error}</div>}
        <div style={{ paddingTop: 8, borderTop: "1px solid var(--border-subtle)" }}>
          <button type="submit" className="btn-add" disabled={busy !== null}>
            {busy ? "…" : tr("Save AI & modality defaults")}
          </button>
        </div>
      </form>
    </section>
  );
}

export function ProviderNetworkRulesPanel() {
  const tr = useTranslator();
  const state = useFetch<Record<string, unknown>>("/api/settings");
  const [errorRulesText, setErrorRulesText] = useState("");
  const [ruleProvider, setRuleProvider] = useState("");
  const [ruleStatus, setRuleStatus] = useState("400");
  const [ruleMatch, setRuleMatch] = useState("");
  const [ruleScope, setRuleScope] = useState<"model" | "provider" | "connection">("model");
  const [ruleReason, setRuleReason] = useState("quota_exhausted");
  const [ruleCooldownSec, setRuleCooldownSec] = useState("300");

  useEffect(() => {
    if (state.status === "ok") {
      setErrorRulesText(formatProviderErrorRulesText(state.data.providerErrorRules));
    }
  }, [state.status, state.data]);

  const { busy, error, run } = useAction(() => {
    toast.success(tr("Custom provider error rules saved"));
    state.reload();
  });

  function appendRule() {
    if (!ruleProvider.trim() || !ruleMatch.trim()) return;
    const line = `${ruleProvider.trim()} | ${ruleStatus} | ${ruleMatch.trim()} | ${ruleScope} | ${ruleReason} | ${ruleCooldownSec}`;
    setErrorRulesText((cur) => (cur.trim() ? `${cur.trim()}\n${line}` : line));
    setRuleMatch("");
  }

  async function saveRules(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseProviderErrorRulesText(errorRulesText);
    if (parsed.ok === false) {
      toast.error(parsed.error);
      return;
    }
    await run("save-rules", () =>
      api.patch("/api/settings", {
        providerErrorRules: parsed.rules as unknown as JsonValue,
      }),
    );
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <OutboundProxyConfigSection />

      <section className="settings-card">
        <div className="section-head" style={{ marginBottom: 12 }}>
          <div>
            <h2 style={{ marginBottom: 4 }}>{tr("Custom Provider Error Rules")}</h2>
            <p className="muted" style={{ margin: 0 }}>
              {tr("Override cooldown classification per provider when upstream returns non-standard error codes (e.g. HTTP 400 code 6000 or 11128).")}
            </p>
          </div>
        </div>

        <form onSubmit={saveRules} className="stack-form">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, alignItems: "end" }}>
            <label>
              {tr("Provider ID")}
              <input type="text" placeholder="codebuddy-cn" value={ruleProvider} onChange={(e) => setRuleProvider(e.target.value)} />
            </label>
            <label>
              {tr("HTTP status")}
              <input type="number" min={100} max={599} value={ruleStatus} onChange={(e) => setRuleStatus(e.target.value)} />
            </label>
            <label>
              {tr("Body substring")}
              <input type="text" placeholder="code 6000" value={ruleMatch} onChange={(e) => setRuleMatch(e.target.value)} />
            </label>
            <label>
              {tr("Lock scope")}
              <select value={ruleScope} onChange={(e) => setRuleScope(e.target.value as "model" | "provider" | "connection")}>
                <option value="model">model</option>
                <option value="connection">connection</option>
                <option value="provider">provider</option>
              </select>
            </label>
            <label>
              {tr("Reason")}
              <select value={ruleReason} onChange={(e) => setRuleReason(e.target.value)}>
                <option value="quota_exhausted">quota_exhausted</option>
                <option value="rate_limit_exceeded">rate_limit_exceeded</option>
                <option value="model_capacity">model_capacity</option>
                <option value="auth_error">auth_error</option>
                <option value="server_error">server_error</option>
              </select>
            </label>
            <label>
              {tr("Cooldown (sec)")}
              <input type="number" min={0} max={86400} value={ruleCooldownSec} onChange={(e) => setRuleCooldownSec(e.target.value)} />
            </label>
          </div>
          <div>
            <button type="button" className="btn-ghost" disabled={!ruleProvider.trim() || !ruleMatch.trim()} onClick={appendRule}>
              <Plus size={14} />
              <span>{tr("Add rule to list")}</span>
            </button>
          </div>
          <label>
            <span className="muted" style={{ fontSize: 14 }}>
              {tr("Active rules (")}<code>provider | status | substring | scope | reason | cooldownSec</code>)
            </span>
            <textarea
              rows={4}
              aria-label={tr("Custom provider error rules")}
              value={errorRulesText}
              onChange={(e) => setErrorRulesText(e.target.value)}
              placeholder={"codebuddy-cn | 400 | 6000 | model | quota_exhausted | 300"}
            />
          </label>
          {error && <p className="bad">{error}</p>}
          <div>
            <button type="submit" className="btn-add" disabled={busy !== null}>
              {busy ? "…" : tr("Save error rules")}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

import { useTranslator } from "../lib/useTranslator.ts";
import { useEffect, useState } from "react";
import { DatabaseBackup, KeyRound, Plus, SlidersHorizontal, Trash2, Wrench } from "lucide-react";
import { toast } from "sonner";
import { LoadingState } from "../components/PageStates.tsx";
import { api, type JsonValue } from "../lib/api.ts";
import { useAction } from "../lib/actions.tsx";
import { when } from "../lib/format.ts";
import { useFetch } from "../lib/useFetch.ts";
import { usePreferences } from "../lib/preferences.tsx";
import { AdvancedSettings } from "../components/settings/AdvancedSettings.tsx";

type SettingsBag = Record<string, unknown>;
type SettingsTab = "runtime" | "security" | "backups" | "advanced";

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
  const { t, language, setLanguage, theme, setTheme } = usePreferences();
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

      <section className="settings-personal" aria-label={t("Appearance")}>
        <label>{t("Language")}<select value={language} onChange={e => setLanguage(e.target.value as "en" | "id")}><option value="en">English</option><option value="id">Bahasa Indonesia</option></select></label>
        <label>{t("Appearance")}<select value={theme} onChange={e => setTheme(e.target.value as "system" | "dark" | "light")}><option value="system">{t("System theme")}</option><option value="dark">{t("Dark")}</option><option value="light">{t("Light")}</option></select></label>
      </section>
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

      {tab === "security" && <ChangePassword />}

      {tab === "backups" && <DatabaseBackupsSection />}

      {tab === "advanced" && <AdvancedSettings settings={state.status === "ok" ? state.data : {}} loading={state.status === "loading"} error={state.status === "error" ? state.error.message : undefined} />}
    </div>
  );
}

interface WildcardAlias {
  pattern: string;
  target: string;
}

function RoutingAndRuntimeSettings({ initial, onSaved }: { initial: SettingsBag; onSaved: () => void }) {
  const tr = useTranslator();
  const { t } = usePreferences();
  const [fallbackStrategy, setFallbackStrategy] = useState<string>(String(initial.fallbackStrategy ?? "priority"));
  const [comboStrategy, setComboStrategy] = useState<string>(String(initial.comboStrategy ?? "fallback"));
  const [requestRetry, setRequestRetry] = useState<number>(Number(initial.requestRetry ?? 2));
  const [maxRetryIntervalSec, setMaxRetryIntervalSec] = useState<number>(Number(initial.maxRetryIntervalSec ?? 30));
  const [stickyLimit, setStickyLimit] = useState<number>(Number(initial.stickyRoundRobinLimit ?? 0));
  const [disableStickiness, setDisableStickiness] = useState<boolean>(Boolean(initial.disableSessionStickiness));
  const [promptCacheAffinity, setPromptCacheAffinity] = useState<boolean>(initial.promptCacheAffinityEnabled !== false);
  const [lkgpEnabled, setLkgpEnabled] = useState<boolean>(Boolean(initial.lkgpEnabled));
  const [autoRefreshQuota, setAutoRefreshQuota] = useState<boolean>(initial.autoRefreshProviderQuota !== false);
  const [hideHealthLogs, setHideHealthLogs] = useState<boolean>(Boolean(initial.hideHealthCheckLogs));
  const [debugMode, setDebugMode] = useState<boolean>(Boolean(initial.debugMode));
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
    setDisableStickiness(Boolean(initial.disableSessionStickiness));
    setPromptCacheAffinity(initial.promptCacheAffinityEnabled !== false);
    setLkgpEnabled(Boolean(initial.lkgpEnabled));
    setAutoRefreshQuota(initial.autoRefreshProviderQuota !== false);
    setHideHealthLogs(Boolean(initial.hideHealthCheckLogs));
    setDebugMode(Boolean(initial.debugMode));
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
    const payload: Record<string, JsonValue> = {
      fallbackStrategy,
      comboStrategy,
      requestRetry: Math.max(0, Math.min(10, Math.round(requestRetry))),
      maxRetryIntervalSec: Math.max(0, Math.min(300, Math.round(maxRetryIntervalSec))),
      stickyRoundRobinLimit: Math.max(0, Math.min(1000, Math.round(stickyLimit))),
      disableSessionStickiness: disableStickiness,
      promptCacheAffinityEnabled: promptCacheAffinity,
      lkgpEnabled,
      autoRefreshProviderQuota: autoRefreshQuota,
      hideHealthCheckLogs: hideHealthLogs,
      debugMode,
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

  async function createSnapshot() {
    const out = await run("backup", () => api.post<{ filename: string; size: number }>("/api/backups"));
    if (out) {
      toast.success(`Created backup ${out.filename} (${formatBytes(out.size)})`);
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
        </div>
      )}
    </section>
  );
}


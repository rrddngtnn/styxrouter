import { useTranslator } from "../lib/useTranslator.ts";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Activity, Cpu, Database, DatabaseBackup, GitBranch, KeyRound, Trash2, Wrench } from "lucide-react";
import { toast } from "sonner";
import { LoadingState } from "../components/PageStates.tsx";
import { api } from "../lib/api.ts";
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
type SettingsTab = "health" | "security" | "backups" | "advanced";

export function Settings() {
  const tr = useTranslator();
  const { t } = usePreferences();
  const [tab, setTab] = useState<SettingsTab>("health");
  const state = useFetch<SettingsBag>("/api/settings");

  return (
    <div className="page">
      <div className="section-head" style={{ marginBottom: 16 }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>{t("Settings")}</h1>
          <p className="muted" style={{ margin: 0 }}>
            {tr("System health, CLI version drift, management security, SQLite backups, and portable configuration.")}
          </p>
        </div>
      </div>

      <section className="card" style={{ padding: 14, marginBottom: 16 }} aria-label={tr("Contextual workspace shortcuts")}>
        <div style={{ marginBottom: 8, fontSize: 14 }} className="muted">
          {tr("Domain controls live directly inside their operational workspaces:")}
        </div>
        <div className="row-actions" style={{ flexWrap: "wrap", gap: 8 }}>
          <Link to="/routing" className="btn-ghost" style={{ textDecoration: "none" }}>
            <GitBranch size={14} />
            <span>{tr("Routing → Failover, Pacing, Aliases & Trace")}</span>
          </Link>
          <Link to="/models" className="btn-ghost" style={{ textDecoration: "none" }}>
            <Cpu size={14} />
            <span>{tr("Models → Thinking Budget, Vision Bridge & Soul")}</span>
          </Link>
          <Link to="/providers?tab=network" className="btn-ghost" style={{ textDecoration: "none" }}>
            <Database size={14} />
            <span>{tr("Providers → Egress Proxies & Error Rules")}</span>
          </Link>
          <Link to="/activity" className="btn-ghost" style={{ textDecoration: "none" }}>
            <Activity size={14} />
            <span>{tr("Activity → Live Tail & Webhook Alerts")}</span>
          </Link>
        </div>
      </section>

      <div className="tabs" role="tablist" aria-label={tr("Settings sections")}>
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

      {tab === "health" && <HealthAndVersionsSettings />}

      {tab === "security" && (
        <>
          <ChangePassword />
          <EmergencyDispatchPauseSection />
        </>
      )}

      {tab === "backups" && <DatabaseBackupsSection />}

      {tab === "advanced" && <AdvancedSettings settings={state.status === "ok" ? state.data : {}} loading={state.status === "loading"} error={state.status === "error" ? state.error.message : undefined} />}
    </div>
  );
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


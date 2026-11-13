import { useState } from "react";
import { RefreshCw, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../lib/api.ts";
import { useFetch } from "../../lib/useFetch.ts";
import { when } from "../../lib/format.ts";
import { useTranslator } from "../../lib/useTranslator.ts";
import { TableScroll } from "../TableScroll.tsx";

export interface ProviderDispatchHealthRow {
  provider: string;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  hour: { requests: number; failures: number };
  day: { requests: number; failures: number };
}

export interface RoutingTraceEvent {
  time: number;
  kind: "selection" | "outcome";
  provider: string;
  account: string;
  reason: string;
  requestId?: string;
  cooldownMs?: number;
  status?: number;
}

export interface RoutingTracePayload {
  scope?: {
    storage?: string;
    retention?: string;
    maxEvents?: number;
    instanceId?: string;
  };
  events: RoutingTraceEvent[];
}

export interface VersionStatus {
  cachedVersion: string | null;
  pinnedVersion: string | null;
  effectiveVersion: string | null;
  observedVersion?: string | null;
  observedAt?: string | number | null;
}

export interface TokenSchedulerSnapshot {
  enabled: boolean;
  running: boolean;
  lastStartedAt: number | null;
  lastFinishedAt: number | null;
  lastOutcome: "completed" | "failed" | null;
  lastDueCount: number | null;
  lastRefreshedCount: number | null;
  nextScheduledAt: number | null;
}

export interface ProcessHealthSnapshot {
  startedAt: string | null;
  peakRssBytes: number | null;
  userMicroseconds: number | null;
  systemMicroseconds: number | null;
  threadCount: number | null;
  tokenScheduler: TokenSchedulerSnapshot | null;
  storage: {
    databaseBytes: number | null;
    walBytes: number | null;
    lastSuccessfulSchedulerVacuumAt: number | null;
  };
}

const SEMVER_PIN_REGEX = /^\d{1,6}\.\d{1,6}\.\d{1,6}$/;

export function validateSemverPin(raw: string): string | null {
  const trimmed = raw.trim();
  return SEMVER_PIN_REGEX.test(trimmed) ? trimmed : null;
}

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes === 0) return "0 B";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function formatCpuSeconds(micros: number | null | undefined): string {
  if (micros == null || !Number.isFinite(micros) || micros < 0) return "—";
  return `${(micros / 1_000_000).toFixed(2)}s`;
}

function formatObservedTime(ts: string | number | null | undefined): string {
  if (ts == null) return "—";
  const iso = typeof ts === "number" ? new Date(ts).toISOString() : ts;
  return when(iso);
}

interface VersionRowProps {
  title: string;
  subtitle: string;
  status: VersionStatus | null;
  busy: boolean;
  onPin: (version: string | null) => void;
  onRefresh?: () => void;
}

function VersionDriftRow({ title, subtitle, status, busy, onPin, onRefresh }: VersionRowProps) {
  const tr = useTranslator();
  const [draft, setDraft] = useState(status?.pinnedVersion ?? "");
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleSavePin = (e: React.FormEvent) => {
    e.preventDefault();
    const valid = validateSemverPin(draft);
    if (!valid) {
      setValidationError(tr("Enter a valid semantic version (x.y.z), e.g. 3.16.3"));
      return;
    }
    setValidationError(null);
    onPin(valid);
  };

  return (
    <div className="card version-drift-card" style={{ padding: 14 }}>
      <div className="section-head" style={{ marginBottom: 10 }}>
        <div>
          <strong style={{ fontSize: 15 }}>{title}</strong>
          <p className="muted" style={{ margin: "2px 0 0 0", fontSize: 14 }}>{subtitle}</p>
        </div>
        {onRefresh && (
          <button type="button" className="btn-ghost" disabled={busy} onClick={onRefresh}>
            <RefreshCw size={14} />
            <span>{tr("Refresh now")}</span>
          </button>
        )}
      </div>

      <div className="cards" style={{ marginBottom: 12 }}>
        <div>
          <div className="muted" style={{ fontSize: 14 }}>{tr("Effective version")}</div>
          <code>{status?.effectiveVersion ?? "—"}</code>
        </div>
        <div>
          <div className="muted" style={{ fontSize: 14 }}>{tr("Cached upstream")}</div>
          <code>{status?.cachedVersion ?? "—"}</code>
        </div>
        <div>
          <div className="muted" style={{ fontSize: 14 }}>{tr("Pinned override")}</div>
          <code>{status?.pinnedVersion ?? tr("Auto (unpinned)")}</code>
        </div>
        <div>
          <div className="muted" style={{ fontSize: 14 }}>{tr("Last observed")}</div>
          <span>
            <code>{status?.observedVersion ?? "—"}</code>{" "}
            {status?.observedAt ? <span className="muted">({formatObservedTime(status.observedAt)})</span> : null}
          </span>
        </div>
      </div>

      <form onSubmit={handleSavePin} className="row-actions" style={{ flexWrap: "wrap", gap: 8 }}>
        <input
          type="text"
          className="version-pin-input"
          aria-label={`${title} ${tr("Pinned version")}`}
          placeholder={tr("Pinned version (x.y.z)")}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (validationError) setValidationError(null);
          }}
          style={{ maxWidth: 220 }}
        />
        <button type="submit" className="btn-add" disabled={busy || !draft.trim()}>
          <span>{tr("Pin version")}</span>
        </button>
        {status?.pinnedVersion && (
          <button
            type="button"
            className="btn-ghost"
            disabled={busy}
            onClick={() => {
              setDraft("");
              setValidationError(null);
              onPin(null);
            }}
          >
            <span>{tr("Clear pin")}</span>
          </button>
        )}
      </form>
      {validationError && <p className="bad" style={{ marginTop: 8, marginBottom: 0 }}>{validationError}</p>}
    </div>
  );
}

export function HealthAndVersionsView({
  zcode,
  antigravityIde,
  antigravityCli,
  processHealth,
  dispatchHealth = [],
  routingTrace = null,
  busy = false,
  onPinZcode = () => {},
  onRefreshZcode = () => {},
  onPinAntigravity = () => {},
  onRefreshAntigravity = () => {},
  onClearModelLocks,
  onRunTokenHealthPass,
  onReloadAll,
}: {
  zcode: VersionStatus | null;
  antigravityIde: VersionStatus | null;
  antigravityCli: VersionStatus | null;
  processHealth: ProcessHealthSnapshot;
  dispatchHealth?: ProviderDispatchHealthRow[];
  routingTrace?: RoutingTracePayload | null;
  busy?: boolean;
  onPinZcode?: (version: string | null) => void;
  onRefreshZcode?: () => void;
  onPinAntigravity?: (product: "ide" | "cli", version: string | null) => void;
  onRefreshAntigravity?: () => void;
  onClearModelLocks?: () => void;
  onRunTokenHealthPass?: () => void;
  onReloadAll?: () => void;
}) {
  const tr = useTranslator();
  const sched = processHealth.tokenScheduler;
  const recentTraceEvents = (routingTrace?.events ?? []).slice(-25).reverse();

  return (
    <div className="health-versions" style={{ display: "grid", gap: 16 }}>
      <section className="settings-card">
        <div className="section-head" style={{ marginBottom: 12 }}>
          <div>
            <h2 style={{ marginBottom: 4 }}>{tr("Upstream CLI Version Drift & Pinning")}</h2>
            <p className="muted" style={{ margin: 0 }}>
              {tr("Inspect upstream client versions used in outbound headers, force an immediate version pull, or pin a specific x.y.z version during vendor rollouts.")}
            </p>
          </div>
        </div>

        <VersionDriftRow
          title="ZCode CLI"
          subtitle={tr("Outbound Z.ai / ZCode CLI header identity")}
          status={zcode}
          busy={busy}
          onPin={onPinZcode}
          onRefresh={onRefreshZcode}
        />

        <VersionDriftRow
          title="Antigravity IDE"
          subtitle={tr("Standalone IDE diagnostic only; router execution uses Hub or CLI")}
          status={antigravityIde}
          busy={busy}
          onPin={(v) => onPinAntigravity("ide", v)}
          onRefresh={onRefreshAntigravity}
        />

        <VersionDriftRow
          title="Antigravity CLI"
          subtitle={tr("Outbound Antigravity CLI version header")}
          status={antigravityCli}
          busy={busy}
          onPin={(v) => onPinAntigravity("cli", v)}
          onRefresh={onRefreshAntigravity}
        />
      </section>

      <section className="settings-card">
        <div className="section-head" style={{ marginBottom: 12 }}>
          <div>
            <h2 style={{ marginBottom: 4 }}>{tr("Process, Storage & Scheduler Health")}</h2>
            <p className="muted" style={{ margin: 0 }}>
              {tr("Process-local resource metrics, SQLite file footprint, and background OAuth token refresh scheduler status.")}
            </p>
          </div>
          <div className="row-actions" style={{ gap: 8, flexWrap: "wrap" }}>
            {onRunTokenHealthPass && (
              <button type="button" className="btn-ghost" disabled={busy} onClick={onRunTokenHealthPass}>
                <span>{tr("Run token health pass now")}</span>
              </button>
            )}
            {onClearModelLocks && (
              <button type="button" className="btn-ghost" disabled={busy} onClick={onClearModelLocks}>
                <span>{tr("Clear all process model locks")}</span>
              </button>
            )}
            {onReloadAll && (
              <button type="button" className="btn-ghost" disabled={busy} onClick={onReloadAll}>
                <RefreshCw size={14} />
                <span>{tr("Refresh metrics")}</span>
              </button>
            )}
          </div>
        </div>

        <div className="cards" style={{ marginBottom: 12 }}>
          <div>
            <div className="muted" style={{ fontSize: 14 }}>{tr("Process started")}</div>
            <strong>{processHealth.startedAt ? when(processHealth.startedAt) : "—"}</strong>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 14 }}>{tr("Peak RSS memory")}</div>
            <strong>{formatBytes(processHealth.peakRssBytes)}</strong>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 14 }}>{tr("CPU time (user / sys)")}</div>
            <strong>
              {formatCpuSeconds(processHealth.userMicroseconds)} / {formatCpuSeconds(processHealth.systemMicroseconds)}
            </strong>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 14 }}>{tr("Linux threads")}</div>
            <strong>{processHealth.threadCount ?? "—"}</strong>
          </div>
        </div>

        <div className="cards" style={{ marginBottom: 12 }}>
          <div>
            <div className="muted" style={{ fontSize: 14 }}>{tr("SQLite DB size")}</div>
            <strong>{formatBytes(processHealth.storage.databaseBytes)}</strong>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 14 }}>{tr("SQLite WAL size")}</div>
            <strong>{formatBytes(processHealth.storage.walBytes)}</strong>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 14 }}>{tr("Last scheduled VACUUM")}</div>
            <strong>{formatObservedTime(processHealth.storage.lastSuccessfulSchedulerVacuumAt)}</strong>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 14 }}>{tr("Token scheduler")}</div>
            <strong>
              {sched ? (sched.running ? tr("Running") : sched.lastOutcome ?? (sched.enabled ? tr("Idle") : tr("Disabled"))) : "—"}
            </strong>
            {sched?.lastRefreshedCount != null && (
              <div className="muted" style={{ fontSize: 14 }}>
                {tr("Refreshed")}: {sched.lastRefreshedCount}/{sched.lastDueCount ?? sched.lastRefreshedCount}
              </div>
            )}
          </div>
        </div>

        {dispatchHealth.length > 0 && (
          <div className="card" style={{ padding: 0, overflow: "hidden", marginTop: 12 }}>
            <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
              <strong style={{ fontSize: 15 }}>{tr("Outbound provider dispatch health (1h / 24h)")}</strong>
            </div>
            <TableScroll label={tr("Provider dispatch health table")} stickyPrimary>
              <table className="table">
                <thead>
                  <tr>
                    <th>{tr("Provider")}</th>
                    <th>{tr("1h failures / reqs")}</th>
                    <th>{tr("24h failures / reqs")}</th>
                    <th>{tr("Last success")}</th>
                    <th>{tr("Last failure")}</th>
                  </tr>
                </thead>
                <tbody>
                  {dispatchHealth.map((row) => (
                    <tr key={row.provider}>
                      <td>
                        <code>{row.provider}</code>
                      </td>
                      <td>
                        {row.hour.failures} / {row.hour.requests}
                      </td>
                      <td>
                        {row.day.failures} / {row.day.requests}
                      </td>
                      <td className="muted">{row.lastSuccessAt ? when(row.lastSuccessAt) : "—"}</td>
                      <td className="muted">{row.lastFailureAt ? when(row.lastFailureAt) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          </div>
        )}
      </section>

      <section className="settings-card">
        <div className="section-head" style={{ marginBottom: 12 }}>
          <div>
            <h2 style={{ marginBottom: 4 }}>{tr("Routing Decision Trace")}</h2>
            <p className="muted" style={{ margin: 0 }}>
              {tr("Process-local, bounded routing and fallback trace (secret-free pseudonymous provider/account tokens).")}
            </p>
          </div>
        </div>
        {recentTraceEvents.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>{tr("No routing trace events recorded in this process yet.")}</p>
        ) : (
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
                  {recentTraceEvents.map((ev, idx) => (
                    <tr key={`${ev.time}-${idx}`}>
                      <td className="muted">{formatObservedTime(ev.time)}</td>
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
    </div>
  );
}

export function HealthAndVersionsSettings() {
  const zcode = useFetch<VersionStatus>("/api/versions/zcode/status");
  const agIde = useFetch<VersionStatus>("/api/versions/antigravity/ide/status");
  const agCli = useFetch<VersionStatus>("/api/versions/antigravity/cli/status");
  const start = useFetch<{ startedAt: string | null }>("/api/process-health/start");
  const peak = useFetch<{ peakRssBytes: number | null }>("/api/process-health/peak");
  const cpu = useFetch<{ userMicroseconds: number; systemMicroseconds: number }>("/api/process-health/cpu");
  const threads = useFetch<{ threadCount: number | null }>("/api/process-health/threads");
  const sched = useFetch<TokenSchedulerSnapshot>("/api/process-health/token-scheduler");
  const dispatch = useFetch<{ providers?: ProviderDispatchHealthRow[] }>("/api/process-health/dispatch");
  const trace = useFetch<RoutingTracePayload>("/api/routing/trace");
  const storage = useFetch<{ databaseBytes: number | null; walBytes: number | null }>("/api/storage-health");
  const vacuum = useFetch<{ lastSuccessfulSchedulerVacuumAt: number | null }>("/api/storage-health/vacuum");
  const [busy, setBusy] = useState(false);

  const reloadAll = () => {
    zcode.reload();
    agIde.reload();
    agCli.reload();
    start.reload();
    peak.reload();
    cpu.reload();
    threads.reload();
    sched.reload();
    dispatch.reload();
    trace.reload();
    storage.reload();
    vacuum.reload();
  };

  async function pinZcode(version: string | null) {
    setBusy(true);
    try {
      await api.put("/api/versions/zcode/pin", { version });
      toast.success(version ? `Pinned ZCode CLI to ${version}` : "Cleared ZCode CLI version pin");
      zcode.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function refreshZcode() {
    setBusy(true);
    try {
      const res = await api.post<{ version: string; updated: boolean }>("/api/versions/zcode/refresh");
      toast.success(`ZCode CLI: ${res.version}${res.updated ? " (updated)" : " (unchanged)"}`);
      zcode.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function pinAntigravity(product: "ide" | "cli", version: string | null) {
    setBusy(true);
    try {
      await api.put(`/api/versions/antigravity/${product}/pin`, { version });
      toast.success(
        version
          ? `Pinned Antigravity ${product.toUpperCase()} to ${version}`
          : `Cleared Antigravity ${product.toUpperCase()} version pin`,
      );
      if (product === "ide") agIde.reload();
      else agCli.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function refreshAntigravity() {
    setBusy(true);
    try {
      const res = await api.post<{ versions: { ide: string; cli: string } }>("/api/versions/antigravity/refresh");
      toast.success(`Antigravity refreshed: IDE ${res.versions.ide}, CLI ${res.versions.cli}`);
      agIde.reload();
      agCli.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function clearModelLocks() {
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

  async function runTokenHealthPassNow() {
    setBusy(true);
    try {
      const res = await api.post<{ checked: number; refreshed: number }>(
        "/api/process-health/token-scheduler/run",
      );
      toast.success(`Token health pass finished: ${res.checked} due, ${res.refreshed} refreshed`);
      sched.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <HealthAndVersionsView
      zcode={zcode.status === "ok" ? zcode.data : null}
      antigravityIde={agIde.status === "ok" ? agIde.data : null}
      antigravityCli={agCli.status === "ok" ? agCli.data : null}
      processHealth={{
        startedAt: start.status === "ok" ? start.data.startedAt : null,
        peakRssBytes: peak.status === "ok" ? peak.data.peakRssBytes : null,
        userMicroseconds: cpu.status === "ok" ? cpu.data.userMicroseconds : null,
        systemMicroseconds: cpu.status === "ok" ? cpu.data.systemMicroseconds : null,
        threadCount: threads.status === "ok" ? threads.data.threadCount : null,
        tokenScheduler: sched.status === "ok" ? sched.data : null,
        storage: {
          databaseBytes: storage.status === "ok" ? storage.data.databaseBytes : null,
          walBytes: storage.status === "ok" ? storage.data.walBytes : null,
          lastSuccessfulSchedulerVacuumAt:
            vacuum.status === "ok" ? vacuum.data.lastSuccessfulSchedulerVacuumAt : null,
        },
      }}
      dispatchHealth={dispatch.status === "ok" ? dispatch.data.providers ?? [] : []}
      routingTrace={trace.status === "ok" ? trace.data : null}
      busy={busy}
      onPinZcode={pinZcode}
      onRefreshZcode={refreshZcode}
      onPinAntigravity={pinAntigravity}
      onRefreshAntigravity={refreshAntigravity}
      onClearModelLocks={clearModelLocks}
      onRunTokenHealthPass={runTokenHealthPassNow}
      onReloadAll={reloadAll}
    />
  );
}

export interface WebhookSubscriptionRow {
  id: string;
  url: string;
  kind: "slack" | "telegram" | "discord" | "custom";
  events: string[];
  enabled: boolean;
  description: string;
  lastTriggeredAt?: string | null;
  lastStatus?: number | null;
  failureCount?: number;
}

export function WebhookAlertsCard({
  webhooks,
  busy = false,
  onCreate = () => {},
  onToggle = () => {},
  onTest = () => {},
  onDelete = () => {},
}: {
  webhooks: WebhookSubscriptionRow[];
  busy?: boolean;
  onCreate?: (input: { url: string; kind: WebhookSubscriptionRow["kind"]; description: string; events: string[] }) => void;
  onToggle?: (id: string, enabled: boolean) => void;
  onTest?: (id: string) => void;
  onDelete?: (id: string) => void;
}) {
  const tr = useTranslator();
  const [url, setUrl] = useState("");
  const [kind, setKind] = useState<WebhookSubscriptionRow["kind"]>("telegram");
  const [description, setDescription] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>(["quota.exceeded", "request.failed"]);

  const toggleEvent = (ev: string) => {
    setSelectedEvents((cur) => (cur.includes(ev) ? cur.filter((x) => x !== ev) : [...cur, ev]));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || selectedEvents.length === 0) return;
    onCreate({ url: url.trim(), kind, description: description.trim(), events: selectedEvents });
    setUrl("");
    setDescription("");
  };

  return (
    <section className="settings-card">
      <div className="section-head" style={{ marginBottom: 12 }}>
        <div>
          <h2 style={{ marginBottom: 4 }}>{tr("Webhook & Telegram Alert Subscriptions")}</h2>
          <p className="muted" style={{ margin: 0 }}>
            {tr("Receive outbound notifications when account quotas hit thresholds or requests fail across all fallback steps.")}
          </p>
        </div>
      </div>

      <form onSubmit={submit} className="stack-form" style={{ marginBottom: 16 }}>
        <div className="two-col" style={{ gap: 12 }}>
          <label>
            {tr("Target URL (https://…)")}
            <input
              type="url"
              placeholder="https://api.telegram.org/bot… or https://hooks.example.com/…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={busy}
              required
            />
          </label>
          <div className="two-col" style={{ gap: 12 }}>
            <label>
              {tr("Channel kind")}
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as WebhookSubscriptionRow["kind"])}
                disabled={busy}
              >
                <option value="telegram">Telegram</option>
                <option value="discord">Discord</option>
                <option value="slack">Slack</option>
                <option value="custom">Custom HMAC Webhook</option>
              </select>
            </label>
            <label>
              {tr("Label / description")}
              <input
                type="text"
                placeholder={tr("e.g. Ops Telegram Alert")}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={busy}
              />
            </label>
          </div>
        </div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
          {(["quota.exceeded", "request.failed", "request.completed", "test.ping"] as const).map((ev) => (
            <label key={ev} className="check" style={{ fontSize: 14 }}>
              <input
                type="checkbox"
                checked={selectedEvents.includes(ev)}
                onChange={() => toggleEvent(ev)}
                disabled={busy}
              />
              <code>{ev}</code>
            </label>
          ))}
          <button type="submit" className="btn-add" disabled={busy || !url.trim() || selectedEvents.length === 0}>
            <span>{tr("Add webhook")}</span>
          </button>
        </div>
      </form>

      {webhooks.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>{tr("No webhook subscriptions configured.")}</p>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <TableScroll label={tr("Webhooks table")} stickyPrimary>
            <table className="table">
              <thead>
                <tr>
                  <th>{tr("Destination")}</th>
                  <th>{tr("Kind")}</th>
                  <th>{tr("Events")}</th>
                  <th>{tr("Status")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {webhooks.map((w) => (
                  <tr key={w.id}>
                    <td>
                      <div>
                        <strong>{w.description || w.url}</strong>
                      </div>
                      {w.description && (
                        <div className="muted" style={{ fontSize: 14 }}>
                          <code>{w.url}</code>
                        </div>
                      )}
                    </td>
                    <td>
                      <span className="vendor-badge">{w.kind}</span>
                    </td>
                    <td>
                      <code>{w.events.join(", ")}</code>
                    </td>
                    <td className={w.enabled ? "ok" : "muted"}>
                      {w.enabled ? tr("enabled") : tr("disabled")}
                      {w.lastStatus ? ` · HTTP ${w.lastStatus}` : ""}
                    </td>
                    <td className="row-actions">
                      <button
                        type="button"
                        className="btn-ghost"
                        disabled={busy}
                        onClick={() => onTest(w.id)}
                      >
                        {tr("Test ping")}
                      </button>
                      <button
                        type="button"
                        className="btn-ghost"
                        disabled={busy}
                        onClick={() => onToggle(w.id, !w.enabled)}
                      >
                        {w.enabled ? tr("Disable") : tr("Enable")}
                      </button>
                      <button
                        type="button"
                        className="btn-danger"
                        disabled={busy}
                        onClick={() => onDelete(w.id)}
                      >
                        {tr("Delete")}
                      </button>
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

export function WebhookAlertsSection() {
  const state = useFetch<{ webhooks?: WebhookSubscriptionRow[] }>("/api/webhooks");
  const [busy, setBusy] = useState(false);
  const rows = state.status === "ok" ? state.data.webhooks ?? [] : [];

  async function create(input: {
    url: string;
    kind: WebhookSubscriptionRow["kind"];
    description: string;
    events: string[];
  }) {
    setBusy(true);
    try {
      await api.post("/api/webhooks", input);
      toast.success("Webhook subscription added");
      state.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(id: string, enabled: boolean) {
    setBusy(true);
    try {
      await api.patch(`/api/webhooks/${encodeURIComponent(id)}`, { enabled });
      state.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      await api.delete(`/api/webhooks/${encodeURIComponent(id)}`);
      toast.success("Webhook deleted");
      state.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function testPing(id: string) {
    setBusy(true);
    try {
      const res = await api.post<{ success: boolean; status: number; error?: string }>(
        `/api/webhooks/${encodeURIComponent(id)}/test`,
      );
      if (res.success) toast.success(`Webhook ping succeeded (HTTP ${res.status})`);
      else toast.error(res.error ?? `Webhook ping failed (HTTP ${res.status})`);
      state.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <WebhookAlertsCard
      webhooks={rows}
      busy={busy}
      onCreate={create}
      onToggle={toggle}
      onTest={testPing}
      onDelete={remove}
    />
  );
}

export interface RedactedProxyEntry {
  type: string;
  host: string;
  port: string | number;
  username?: string;
  hasPassword?: boolean;
}

export function OutboundProxyConfigSection() {
  const tr = useTranslator();
  const state = useFetch<{
    global: RedactedProxyEntry | null;
    providers: Record<string, RedactedProxyEntry>;
    keys: Record<string, RedactedProxyEntry>;
  }>("/api/proxies/config");
  const [level, setLevel] = useState<"global" | "provider" | "key">("provider");
  const [targetId, setTargetId] = useState("");
  const [proxyUrl, setProxyUrl] = useState("");
  const [busy, setBusy] = useState(false);

  async function saveProxy(e: React.FormEvent) {
    e.preventDefault();
    if (level !== "global" && !targetId.trim()) return;
    setBusy(true);
    try {
      await api.put("/api/proxies/config", {
        level,
        id: level === "global" ? null : targetId.trim(),
        proxyUrl: proxyUrl.trim() || null,
      });
      toast.success(proxyUrl.trim() ? "Outbound proxy updated" : "Outbound proxy cleared");
      setProxyUrl("");
      state.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function clearScope(scopeLevel: "global" | "provider" | "key", id: string | null) {
    setBusy(true);
    try {
      await api.put("/api/proxies/config", { level: scopeLevel, id, proxyUrl: null });
      toast.success("Proxy binding removed");
      state.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const data = state.status === "ok" ? state.data : null;
  const providerEntries = Object.entries(data?.providers ?? {});
  const keyEntries = Object.entries(data?.keys ?? {});

  return (
    <section className="settings-card">
      <div className="section-head" style={{ marginBottom: 12 }}>
        <div>
          <h2 style={{ marginBottom: 4 }}>{tr("Outbound Egress Proxy Binding")}</h2>
          <p className="muted" style={{ margin: 0 }}>
            {tr("Assign HTTP/HTTPS/SOCKS5 egress proxies globally, per provider, or per account ID to isolate upstream traffic IPs.")}
          </p>
        </div>
      </div>

      <form onSubmit={saveProxy} className="stack-form" style={{ marginBottom: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
          <label>
            {tr("Scope")}
            <select
              value={level}
              onChange={(e) => setLevel(e.target.value as "global" | "provider" | "key")}
              disabled={busy}
            >
              <option value="provider">{tr("Per provider (e.g. codebuddy-cn)")}</option>
              <option value="key">{tr("Per account connection ID")}</option>
              <option value="global">{tr("Global fallback proxy")}</option>
            </select>
          </label>
          {level !== "global" && (
            <label>
              {level === "provider" ? tr("Provider ID") : tr("Account Connection ID")}
              <input
                type="text"
                placeholder={level === "provider" ? "codebuddy-cn, antigravity, claude…" : "connection UUID"}
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                disabled={busy}
                required
              />
            </label>
          )}
          <label>
            {tr("Proxy URL (http:// or socks5://)")}
            <input
              type="text"
              placeholder="http://user:pass@host:8080 or socks5://host:1080"
              value={proxyUrl}
              onChange={(e) => setProxyUrl(e.target.value)}
              disabled={busy}
              required
            />
          </label>
        </div>
        <div>
          <button
            type="submit"
            className="btn-add"
            disabled={busy || !proxyUrl.trim() || (level !== "global" && !targetId.trim())}
          >
            <span>{tr("Assign proxy")}</span>
          </button>
        </div>
      </form>

      {(data?.global || providerEntries.length > 0 || keyEntries.length > 0) ? (
        <div style={{ display: "grid", gap: 8, fontSize: 14 }}>
          {data?.global && (
            <div className="card" style={{ padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>
                <strong>{tr("Global")}</strong>:{" "}
                <code>
                  {data.global.type}://{data.global.username ? `${data.global.username}:***@` : ""}
                  {data.global.host}:{data.global.port}
                </code>
              </span>
              <button type="button" className="btn-ghost" disabled={busy} onClick={() => void clearScope("global", null)}>
                {tr("Remove")}
              </button>
            </div>
          )}
          {providerEntries.map(([provId, p]) => (
            <div key={`prov-${provId}`} className="card" style={{ padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>
                <strong>{tr("Provider")}</strong> <code>{provId}</code> →{" "}
                <code>
                  {p.type}://{p.username ? `${p.username}:***@` : ""}
                  {p.host}:{p.port}
                </code>
              </span>
              <button type="button" className="btn-ghost" disabled={busy} onClick={() => void clearScope("provider", provId)}>
                {tr("Remove")}
              </button>
            </div>
          ))}
          {keyEntries.map(([connId, p]) => (
            <div key={`key-${connId}`} className="card" style={{ padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>
                <strong>{tr("Account")}</strong> <code>{connId}</code> →{" "}
                <code>
                  {p.type}://{p.username ? `${p.username}:***@` : ""}
                  {p.host}:{p.port}
                </code>
              </span>
              <button type="button" className="btn-ghost" disabled={busy} onClick={() => void clearScope("key", connId)}>
                {tr("Remove")}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted" style={{ margin: 0 }}>{tr("No custom outbound proxies assigned (using direct host egress).")}</p>
      )}
    </section>
  );
}

export function EmergencyDispatchPauseCard({
  totalCount,
  activeCount,
  confirming,
  busy,
  onRequestPause,
  onConfirmPause,
  onCancelPause,
  onResumeAll,
}: {
  totalCount: number;
  activeCount: number;
  confirming: boolean;
  busy: boolean;
  onRequestPause: () => void;
  onConfirmPause: () => void;
  onCancelPause: () => void;
  onResumeAll: () => void;
}) {
  const tr = useTranslator();
  const inactiveCount = Math.max(0, totalCount - activeCount);

  return (
    <section className="settings-card" style={{ marginTop: 16 }}>
      <div className="section-head" style={{ marginBottom: 8 }}>
        <div>
          <h2 style={{ marginBottom: 4 }}>{tr("Emergency dispatch pause")}</h2>
          <p className="muted" style={{ margin: 0 }}>
            {tr("Immediately deactivate all connected provider accounts in one click if you suspect credential leakage or an upstream ban wave.")}
          </p>
        </div>
      </div>

      <p style={{ margin: "8px 0 12px 0", fontSize: 14 }}>
        {tr("Active accounts")}: <strong>{activeCount}</strong> / <strong>{totalCount}</strong>
      </p>

      {!confirming ? (
        <div className="row-actions" style={{ gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn-danger"
            disabled={busy || activeCount === 0}
            onClick={onRequestPause}
          >
            <ShieldAlert size={14} />
            <span>{tr("Disable all active accounts")}</span>
          </button>
          {inactiveCount > 0 && (
            <button
              type="button"
              className="btn-ghost"
              disabled={busy}
              onClick={onResumeAll}
            >
              <span>{tr("Re-enable all accounts")}</span>
            </button>
          )}
        </div>
      ) : (
        <div className="card" style={{ padding: 12 }}>
          <p style={{ margin: "0 0 10px 0", fontSize: 14 }}>
            {tr("Confirm deactivating all")} <strong>{activeCount}</strong> {tr("active accounts? Outbound dispatch will stop until accounts are re-enabled.")}
          </p>
          <div className="row-actions" style={{ gap: 8 }}>
            <button type="button" className="btn-danger" disabled={busy} onClick={onConfirmPause}>
              <span>{busy ? "…" : tr("Confirm disable all")}</span>
            </button>
            <button type="button" className="btn-ghost" disabled={busy} onClick={onCancelPause}>
              <span>{tr("Cancel")}</span>
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

export function EmergencyDispatchPauseSection() {
  const conns = useFetch<{ connections?: { id: string; isActive: boolean }[] }>("/api/connections");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const rows = conns.status === "ok" ? conns.data.connections ?? [] : [];
  const activeIds = rows.filter((r) => r.isActive).map((r) => r.id);
  const inactiveIds = rows.filter((r) => !r.isActive).map((r) => r.id);

  async function pauseAll() {
    if (!activeIds.length) return;
    setBusy(true);
    try {
      await api.post("/api/connections/bulk-active", { ids: activeIds, isActive: false });
      toast.success(`Deactivated ${activeIds.length} account(s)`);
      setConfirming(false);
      conns.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function resumeAll() {
    if (!inactiveIds.length) return;
    setBusy(true);
    try {
      await api.post("/api/connections/bulk-active", { ids: inactiveIds, isActive: true });
      toast.success(`Re-enabled ${inactiveIds.length} account(s)`);
      conns.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <EmergencyDispatchPauseCard
      totalCount={rows.length}
      activeCount={activeIds.length}
      confirming={confirming}
      busy={busy}
      onRequestPause={() => setConfirming(true)}
      onConfirmPause={pauseAll}
      onCancelPause={() => setConfirming(false)}
      onResumeAll={resumeAll}
    />
  );
}

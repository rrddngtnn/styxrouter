import { useState } from "react";
import { RefreshCw, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../lib/api.ts";
import { useFetch } from "../../lib/useFetch.ts";
import { when } from "../../lib/format.ts";
import { useTranslator } from "../../lib/useTranslator.ts";

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
    <div className="card" style={{ padding: 14, marginBottom: 12 }}>
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
  busy = false,
  onPinZcode = () => {},
  onRefreshZcode = () => {},
  onPinAntigravity = () => {},
  onRefreshAntigravity = () => {},
  onReloadAll,
}: {
  zcode: VersionStatus | null;
  antigravityIde: VersionStatus | null;
  antigravityCli: VersionStatus | null;
  processHealth: ProcessHealthSnapshot;
  busy?: boolean;
  onPinZcode?: (version: string | null) => void;
  onRefreshZcode?: () => void;
  onPinAntigravity?: (product: "ide" | "cli", version: string | null) => void;
  onRefreshAntigravity?: () => void;
  onReloadAll?: () => void;
}) {
  const tr = useTranslator();
  const sched = processHealth.tokenScheduler;

  return (
    <div style={{ display: "grid", gap: 16 }}>
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
          subtitle={tr("Outbound Antigravity IDE version header")}
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
          {onReloadAll && (
            <button type="button" className="btn-ghost" disabled={busy} onClick={onReloadAll}>
              <RefreshCw size={14} />
              <span>{tr("Refresh metrics")}</span>
            </button>
          )}
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
      busy={busy}
      onPinZcode={pinZcode}
      onRefreshZcode={refreshZcode}
      onPinAntigravity={pinAntigravity}
      onRefreshAntigravity={refreshAntigravity}
      onReloadAll={reloadAll}
    />
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

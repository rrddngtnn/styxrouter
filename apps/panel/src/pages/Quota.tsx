import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Pagination } from "../components/Pagination.tsx";
import { paginationState } from "../lib/pagination.ts";
import { api } from "../lib/api.ts";
import { Meter } from "../lib/charts.tsx";
import { DASH, ago, int, providerLabel, resetText } from "../lib/format.ts";
import type { ProviderInfo, QuotaRow, QuotaWindow } from "../lib/types.ts";
import { useFetch } from "../lib/useFetch.ts";
import { useNow } from "../lib/useNow.ts";
import "./quota.css";

interface NodeInfo {
  id: string;
  name: string;
  prefix: string | null;
}

type Live = { busy?: boolean; data?: unknown; error?: string };

const fmtPct = (pct?: number | null) => {
  if (pct == null || Number.isNaN(pct)) return DASH;
  if (pct > 0 && pct < 1) return `${pct.toFixed(2)}%`;
  if (pct > 99 && pct < 100) return `${pct.toFixed(1)}%`;
  return `${Math.round(pct)}%`;
};

const fmtUsedLimit = (w: { used?: number | null; total?: number | null; remaining?: number | null }) => {
  if (w.used != null && w.total != null) {
    // Antigravity reports synthetic 0..1000 fraction units; show remaining/total or hide synthetic 1000 when percentage is already shown.
    if (w.total === 1000 && w.remaining == null) return `${int(w.used)} / 1,000 pts`;
    if (w.remaining != null && w.total >= 10000) return `${int(w.used)} / ${int(w.total)} (${int(w.remaining)} left)`;
    return `${int(w.used)} / ${int(w.total)}`;
  }
  if (w.remaining != null) return `${int(w.remaining)} left`;
  return DASH;
};

export function Quota() {
  const now = useNow(1000);
  const state = useFetch<{ providers?: QuotaRow[] }>("/api/usage/quota");
  const provs = useFetch<{ providers?: ProviderInfo[] }>("/api/providers");
  const nodes = useFetch<{ nodes?: NodeInfo[] }>("/api/provider-nodes");
  const [live, setLive] = useState<Record<string, Live>>({});
  const [syncingAll, setSyncingAll] = useState(false);
  const [syncSummary, setSyncSummary] = useState<string | null>(null);

  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of provs.status === "ok" ? provs.data.providers ?? [] : []) {
      m.set(p.id, p.name ?? p.id);
    }
    for (const n of nodes.status === "ok" ? nodes.data.nodes ?? [] : []) {
      m.set(n.id, n.prefix ? `${n.name} (${n.prefix})` : n.name);
    }
    return m;
  }, [provs, nodes]);

  async function refresh(id: string) {
    setLive((l) => ({ ...l, [id]: { busy: true } }));
    try {
      const data = await api.get<unknown>(`/api/usage/${encodeURIComponent(id)}`);
      setLive((l) => ({ ...l, [id]: { data } }));
      state.reload();
      toast.success("Account quota refreshed");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLive((l) => ({ ...l, [id]: { error: msg } }));
      toast.error(msg);
    }
  }

  async function checkGroup(rows: QuotaRow[]) {
    const checkable = rows.filter((r) => r.quotaSupported !== false && r.isActive !== false);
    if (checkable.length === 0) return;
    for (const r of checkable) await refresh(r.connectionId);
  }

  async function syncAllNow() {
    setSyncingAll(true);
    setSyncSummary(null);
    try {
      const res = await api.post<{ succeeded?: number; total?: number; failed?: number }>("/api/usage/provider-limits");
      const msg = `Synced ${res?.succeeded ?? 0}/${res?.total ?? 0} accounts${res?.failed ? ` (${res.failed} failed)` : ""}.`;
      setSyncSummary(msg);
      toast.success(msg);
      state.reload();
    } catch (e) {
      const msg = `Sync failed: ${e instanceof Error ? e.message : String(e)}`;
      setSyncSummary(msg);
      toast.error(msg);
    } finally {
      setSyncingAll(false);
    }
  }

  return (
    <div className="page quota-page">
      <h1>Quota</h1>
      <p className="muted">
        Choose a provider to explore account allowances, model windows, and reset times. Quotas are cached until refreshed.
      </p>
      <div className="toolbar">
        <button type="button" className="btn-add" disabled={syncingAll} onClick={syncAllNow}>
          {syncingAll ? "Syncing all…" : "Sync all quotas"}
        </button>
        <button type="button" className="btn-ghost" onClick={state.reload}>Reload cached view</button>
        {syncSummary && <span className="muted">{syncSummary}</span>}
      </div>
      {state.status === "loading" && <p>Loading...</p>}
      {state.status === "error" && <p className="bad">{state.error.message}</p>}
      {state.status === "ok" && !state.data.providers?.length && <p className="muted">No accounts connected.</p>}
      {state.status === "ok" && <QuotaBrowser rows={state.data.providers ?? []} names={names} now={now} live={live} syncingAll={syncingAll} onRefresh={refresh} onCheckGroup={checkGroup} />}
    </div>
  );
}

export function quotaPage(rows: QuotaRow[], search: string, requestedPage: number, pageSize = 8) {
  const query = search.trim().toLowerCase();
  const filtered = rows.filter(r => !query || `${r.name} ${r.plan ?? ""}`.toLowerCase().includes(query));
  const { page, pages, total, pageSize: size } = paginationState(filtered.length, pageSize, requestedPage);
  return { rows: filtered.slice((page - 1) * size, page * size), total, pages, page };
}

export function QuotaBrowser({ rows, names, now, live, syncingAll, onRefresh, onCheckGroup }: {
  rows: QuotaRow[]; names: Map<string, string>; now: number; live: Record<string, Live>; syncingAll: boolean;
  onRefresh: (id: string) => void; onCheckGroup: (rows: QuotaRow[]) => void;
}) {
  const [selected, setSelected] = useState(rows[0]?.provider ?? "");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(8);
  const providers = [...new Set(rows.map(r => r.provider))];
  const current = providers.includes(selected) ? selected : providers[0];
  const pool = rows.filter(r => r.provider === current);
  const result = quotaPage(pool, search, page, pageSize);
  // Keep controlled state in sync when cached data removes pages or providers.
  if (page !== result.page) setPage(result.page);
  if (current && current !== selected) { setSelected(current); setPage(1); }
  const busy = syncingAll || Object.values(live).some(l => l.busy);
  return <>
    <div className="quota-provider-grid" aria-label="Provider categories">
      {providers.map(provider => {
        const count = rows.filter(r => r.provider === provider).length;
        return <button key={provider} className="quota-provider" aria-pressed={provider === current} onClick={() => { setSelected(provider); setPage(1); setSearch(""); }}>
          <strong>{providerLabel(provider, names)}</strong>
          <small>{count} {count === 1 ? "account" : "accounts"}</small>
        </button>;
      })}
    </div>
    <div className="toolbar">
      <input aria-label="Search accounts" type="search" placeholder="Search accounts" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
      <span className="muted">{result.total} {result.total === 1 ? "account" : "accounts"}</span>
      <button className="btn-ghost" disabled={busy || !pool.some(r => r.quotaSupported !== false && r.isActive !== false)} onClick={() => onCheckGroup(pool)}>Refresh provider</button>
    </div>
    <div className="quota-account-grid">
      {result.rows.map(row => {
        const status = live[row.connectionId];
        const fresh = status?.data !== undefined ? toWindows(row.provider, status.data) : [];
        const windows = fresh.length ? fresh : row.windows ?? [];
        return <article className="quota-account" key={row.connectionId}>
          <header><h3>{row.name}</h3><span className="vendor-badge">{row.plan ?? "Plan unknown"}</span></header>
          <div className={tokenTone(row.tokenStatus)}>{row.isActive === false ? "Disabled · " : ""}{row.tokenStatus}</div>
          {row.quotaSupported === false ? <p className="muted">Upstream quota API unavailable</p> : windows.length === 0 ? <p className="muted">{row.message ?? "Not synced yet"}</p> : windows.map(w => <section className="quota-window" key={w.key}>
            <div className="quota-window-head"><strong>{w.label}</strong><span>{w.unlimited ? "Unlimited" : `${fmtPct(w.percentRemaining)} left`}</span></div>
            {w.percentRemaining !== null && !w.unlimited && <Meter value={w.percentRemaining} />}
            <div className="quota-window-head"><span>{w.used != null && w.total != null ? `${fmtUsedLimit(w)} used` : fmtUsedLimit(w)}</span><span>{resetText(w.resetAt, now)}</span></div>
            {!!w.models?.length && <details><summary>Models ({w.models.length})</summary>{w.models.join(", ")}</details>}
          </section>)}
          {(status?.error || row.message) && <p className="bad">{status?.error ?? row.message}</p>}
          <footer><small className="muted">{row.fetchedAt ? ago(row.fetchedAt, now) : "Never synced"}</small>{row.quotaSupported !== false && <button className="btn-ghost" disabled={busy} onClick={() => onRefresh(row.connectionId)}>{status?.busy ? "Checking…" : "Check now"}</button>}</footer>
        </article>;
      })}
    </div>
    {!result.total && <p className="muted">No matching accounts.</p>}
    <Pagination total={result.total} page={result.page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} itemLabel="accounts" />
  </>;
}

function toWindows(provider: string, data: unknown): QuotaWindow[] {
  const q = (data as { quotas?: unknown } | null)?.quotas;
  const entries: [string, unknown][] = Array.isArray(q)
    ? q.map((v, i) => [String((v as { name?: string })?.name ?? `window ${i + 1}`), v])
    : q && typeof q === "object"
      ? Object.entries(q)
      : [];
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const out: QuotaWindow[] = [];

  for (const [rawKey, v] of entries) {
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    const used = n(o.used);
    const total = n(o.total);
    const remaining = n(o.remaining);
    let pct = n(o.remainingPercentage);
    if (total != null && total > 0) {
      const exactRem = remaining != null ? Math.max(0, Math.min(total, remaining)) : used != null ? Math.max(0, total - used) : null;
      if (exactRem != null && (pct === null || (pct === 0 && exactRem > 0))) {
        pct = (exactRem / total) * 100;
      }
    }
    const resetAt = typeof o.resetAt === "string" && o.resetAt ? o.resetAt : null;
    const unlimited = o.unlimited === true;

    if (provider === "antigravity" || provider === "agy") {
      const k = rawKey.toLowerCase();
      const fam = k.startsWith("gemini-4-argon")
        ? { id: "argon", label: "Gemini 4 Argon" }
        : k.startsWith("claude-") || k.startsWith("gpt-oss")
          ? { id: "claude", label: "Claude / GPT-OSS" }
          : k.startsWith("gemini-3")
            ? { id: "flash", label: "Gemini 3 Flash" }
            : { id: rawKey, label: rawKey };
      const groupKey = `${fam.id}:${total ?? -1}:${used ?? -1}:${resetAt ?? ""}`;
      const existing = out.find((w) => w.key === groupKey);
      if (existing) {
        existing.models = [...(existing.models ?? []), rawKey];
        continue;
      }
      out.push({ key: groupKey, label: fam.label, models: [rawKey], used, total, remaining, percentRemaining: pct, resetAt, unlimited });
    } else {
      const label =
        rawKey === "session"
          ? "5h Session"
          : rawKey === "weekly"
            ? "Weekly"
            : typeof o.displayName === "string" && o.displayName.trim()
              ? o.displayName.trim()
              : rawKey;
      out.push({ key: rawKey, label, models: [rawKey], used, total, remaining, percentRemaining: pct, resetAt, unlimited });
    }
  }
  return out;
}

const tokenTone = (s: string) => (s === "valid" ? "ok" : s === "refreshable" || s === "expiring" || s === "refreshing" ? "muted" : "bad");

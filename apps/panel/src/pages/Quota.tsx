import { usePreferences } from "../lib/preferences.tsx";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Pagination } from "../components/Pagination.tsx";
import { ProviderIcon } from "../components/ProviderIcon.tsx";
import { paginationState } from "../lib/pagination.ts";
import { api } from "../lib/api.ts";
import { Meter } from "../lib/charts.tsx";
import { DASH, int, providerLabel, when } from "../lib/format.ts";
import type { ProviderInfo, QuotaRow, QuotaWindow } from "../lib/types.ts";
import { useFetch } from "../lib/useFetch.ts";
import "./quota.css";

const quotaId: Record<string, string> = {
  "Filter by tag": "Filter berdasarkan tag", "Apply tag filter": "Terapkan filter tag", "Clear tag filter": "Hapus filter tag",
  "Hide providers": "Sembunyikan penyedia", "Show providers": "Tampilkan penyedia", "No matching providers.": "Tidak ada penyedia yang cocok.",
  "Selected": "Dipilih", "Remaining unknown": "Sisa tidak diketahui", "Reset (UTC)": "Reset (UTC)",
  "Fresh": "Terbaru", "Cached": "Cache", "Stale": "Data lama", "Freshly checked": "Baru diperiksa",
  "Updated (UTC)": "Diperbarui (UTC)", "Time unknown": "Waktu tidak diketahui", "Quota unavailable": "Kuota tidak tersedia", "More quota windows": "Jendela kuota lainnya",
  "Token": "Token", "valid": "valid", "expired": "kedaluwarsa", "expiring": "akan kedaluwarsa", "refreshing": "sedang diperbarui", "refreshable": "dapat diperbarui",
  "Credit": "Kredit", "Unknown": "Tidak diketahui", "Observed": "Teramati", "Account cooldown": "Jeda akun", "Model cooldowns (this process only)": "Jeda model (hanya proses ini)",
};
function useQuotaTranslator() {
  const { t, language } = usePreferences();
  return (text: string, values?: Record<string, string | number>) => language === "id" && quotaId[text] ? quotaId[text] : t(text, values);
}

interface NodeInfo {
  id: string;
  name: string;
  prefix: string | null;
}

type Live = { busy?: boolean; data?: unknown; error?: string; previousWindows?: QuotaWindow[]; checkedAt?: string; snapshotAt?: string | null };

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
  const tr = useQuotaTranslator();
  const [tagInput, setTagInput] = useState("");
  const [tag, setTag] = useState("");
  const [selectedProvider, setSelectedProvider] = useState("");
  const state = useFetch<{ providers?: QuotaRow[] }>(`/api/usage/quota${tag ? `?tag=${encodeURIComponent(tag)}` : ""}`);
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
    const cachedRow = state.status === "ok" ? state.data.providers?.find(r => r.connectionId === id) : undefined;
    const cached = cachedRow?.windows ?? [];
    setLive((l) => {
      const previous = l[id];
      const earlier = mergeWindows(previous?.previousWindows ?? [], cached);
      const priorStale = asRecord(previous?.data)?._stale === true;
      const priorLive = previous?.data === undefined ? [] : toWindows(state.status === "ok" ? state.data.providers?.find(r => r.connectionId === id)?.provider ?? "" : "", previous.data).map(w => ({ ...w, fetchedAt: priorStale ? null : previous.checkedAt ?? null, stale: priorStale }));
      return { ...l, [id]: { ...previous, busy: true, error: undefined, previousWindows: priorStale ? mergeWindows(priorLive, earlier) : mergeWindows(earlier, priorLive) } };
    });
    try {
      const data = await api.get<unknown>(`/api/usage/${encodeURIComponent(id)}`);
      setLive((l) => ({ ...l, [id]: { ...l[id], busy: false, data, checkedAt: new Date().toISOString(), snapshotAt: cachedRow?.fetchedAt ?? null } }));
      state.reload();
      const response = asRecord(data);
      if (response?._stale === true || typeof response?.message === "string") {
        toast.error(String(response._staleReason ?? response.message ?? "Quota data is stale"));
      } else toast.success("Account quota refreshed");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLive((l) => ({ ...l, [id]: { ...l[id], busy: false, error: msg } }));
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
      <h1>{tr("Quota")}</h1>
      <p className="muted">{tr("Choose a provider to explore account allowances, model windows, and reset times. Quotas are cached until refreshed.")}</p>
      <div className="toolbar">
        <button type="button" className="btn-add" disabled={syncingAll} onClick={syncAllNow}>
          {syncingAll ? tr("Syncing all…") : tr("Sync all quotas")}
        </button>
        <button type="button" className="btn-ghost" onClick={state.reload}>{tr("Reload cached view")}</button>
        {syncSummary && <span className="muted">{syncSummary}</span>}
      </div>
      <form className="toolbar" onSubmit={e => { e.preventDefault(); setTag(tagInput.trim()); }}>
        <input type="search" aria-label={tr("Filter by tag")} placeholder={tr("Filter by tag")} maxLength={64} value={tagInput} onChange={e => setTagInput(e.target.value)} />
        <button type="submit" className="btn-ghost" aria-label={tr("Apply tag filter")}>{tr("Apply tag filter")}</button>
        <button type="button" className="btn-ghost" onClick={() => { setTagInput(""); setTag(""); }}>{tr("Clear tag filter")}</button>
      </form>
      {state.status === "loading" && <p>{tr("Loading...")}</p>}
      {state.status === "error" && <p className="bad">{state.error.message}</p>}
      {state.status === "ok" && !state.data.providers?.length && <p className="muted">{tag ? tr("No matching accounts.") : tr("No accounts connected.")}</p>}
      {state.status === "ok" && <QuotaBrowser rows={state.data.providers ?? []} names={names} live={live} syncingAll={syncingAll} onRefresh={refresh} onCheckGroup={checkGroup} selectedProvider={selectedProvider} onSelectProvider={setSelectedProvider} />}
    </div>
  );
}

export function quotaPage(rows: QuotaRow[], search: string, requestedPage: number, pageSize = 8) {
  const query = search.trim().toLowerCase();
  const filtered = rows.filter(r => !query || `${r.name} ${r.plan ?? ""}`.toLowerCase().includes(query));
  const { page, pages, total, pageSize: size } = paginationState(filtered.length, pageSize, requestedPage);
  return { rows: filtered.slice((page - 1) * size, page * size), total, pages, page };
}

export function QuotaBrowser({ rows, names, live, syncingAll, onRefresh, onCheckGroup, selectedProvider, onSelectProvider }: {
  rows: QuotaRow[]; names: Map<string, string>; now?: number; live: Record<string, Live>; syncingAll: boolean;
  onRefresh: (id: string) => void; onCheckGroup: (rows: QuotaRow[]) => void;
  selectedProvider?: string; onSelectProvider?: (provider: string) => void;
}) {
  const tr = useQuotaTranslator();
  const [localSelected, setLocalSelected] = useState(rows[0]?.provider ?? "");
  const selected = selectedProvider === undefined ? localSelected : selectedProvider;
  const setSelected = onSelectProvider ?? setLocalSelected;
  const [search, setSearch] = useState("");
  const [providerSearch, setProviderSearch] = useState("");
  const [showProviders, setShowProviders] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(8);
  const providers = [...new Set(rows.map(r => r.provider))];
  const current = providers.includes(selected) ? selected : providers[0];
  const pool = rows.filter(r => r.provider === current);
  const result = quotaPage(pool, search, page, pageSize);
  // Keep controlled state in sync when cached data removes pages or providers.
  if (page !== result.page) setPage(result.page);
  const busy = syncingAll || Object.values(live).some(l => l.busy);
  return <>
    <section className="quota-selector" aria-label={tr("Provider categories")}>
      <div className="toolbar quota-selector-toolbar">
        <input aria-label={tr("Search providers")} type="search" placeholder={tr("Search providers")} value={providerSearch} onChange={e => setProviderSearch(e.target.value)} />
        <button type="button" className="btn-ghost" aria-expanded={showProviders} aria-controls="quota-provider-list" onClick={() => setShowProviders(v => !v)}>{showProviders ? tr("Hide providers") : tr("Show providers")}</button>
      </div>
      {showProviders && <div id="quota-provider-list" className="quota-provider-grid">
        {providers.filter(provider => `${provider} ${providerLabel(provider, names)}`.toLowerCase().includes(providerSearch.trim().toLowerCase())).map(provider => {
          const count = rows.filter(r => r.provider === provider).length;
          const label = providerLabel(provider, names);
          return <button type="button" key={provider} className="quota-provider" aria-pressed={provider === current} onClick={() => { setSelected(provider); setPage(1); }}>
            <ProviderIcon providerId={provider} label={label} size={32} />
            <span className="quota-provider-label"><strong>{label}</strong><small>{count} {tr(count === 1 ? "account" : "accounts")}</small></span>
            {provider === current && <span className="quota-selected">{tr("Selected")}</span>}
          </button>;
        })}
      </div>}
      {showProviders && providers.length > 0 && !providers.some(provider => `${provider} ${providerLabel(provider, names)}`.toLowerCase().includes(providerSearch.trim().toLowerCase())) && <p className="muted">{tr("No matching providers.")}</p>}
    </section>
    <div className="toolbar">
      <input aria-label={tr("Search accounts")} type="search" placeholder={tr("Search accounts")} value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
      <span className="muted">{result.total} {tr(result.total === 1 ? "account" : "accounts")}</span>
      <button className="btn-ghost" disabled={busy || !pool.some(r => r.quotaSupported !== false && r.isActive !== false)} onClick={() => onCheckGroup(pool)}>{tr("Refresh provider")}</button>
    </div>
    <div className="quota-account-grid">
      {result.rows.map(row => {
        const status = live[row.connectionId];
        const response = asRecord(status?.data);
        const rawLive = status?.data !== undefined ? toWindows(row.provider, status.data) : [];
        const fresh: QuotaWindow[] = rawLive.map(w => ({ ...w, fetchedAt: response?._stale === true ? null : status?.checkedAt ?? null, stale: response?._stale === true }));
        const baseline = mergeWindows(status?.previousWindows ?? [], row.windows ?? []);
        const cachedNewer = status?.snapshotAt !== undefined
          ? !!row.fetchedAt && row.fetchedAt !== status.snapshotAt
          : !!(status?.checkedAt && row.fetchedAt && Date.parse(row.fetchedAt) > Date.parse(status.checkedAt));
        // Stale responses may contain a merged cache with mixed timestamps; prefer
        // snapshot provenance and retain only response windows absent from it.
        const windows = cachedNewer ? baseline : response?._stale === true ? mergeWindows(fresh, baseline) : mergeWindows(baseline, fresh);
        const stale = (!cachedNewer && response?._stale === true) || !!status?.error;
        const warning = status?.error ?? (typeof response?._staleReason === "string" ? response._staleReason : null) ?? (typeof response?.message === "string" ? response.message : null) ?? row.message;
        const plan = !cachedNewer && typeof response?.plan === "string" ? response.plan : row.plan;
        const fetched = stale ? (typeof response?._staleSince === "string" ? response._staleSince : row.fetchedAt) : (!cachedNewer && fresh.length && status?.checkedAt ? status.checkedAt : row.fetchedAt);
        const renderWindow = (w: QuotaWindow) => {
          const isFresh = !stale && !cachedNewer && w.stale !== true && fresh.includes(w);
          return <section className="quota-window" key={w.key}>
            <div className="quota-window-head"><strong>{tr(w.label)}</strong><span>{w.unlimited ? tr("Unlimited") : w.percentRemaining != null ? tr("{0} left", {0: fmtPct(w.percentRemaining)}) : tr("Remaining unknown")}</span></div>
            {w.percentRemaining != null && Number.isFinite(w.percentRemaining) && !w.unlimited && <Meter value={w.percentRemaining} />}
            <div className="quota-window-head"><span>{w.used != null && w.total != null ? tr("{0} used", {0: fmtUsedLimit(w)}) : fmtUsedLimit(w)}</span><span>{tr("Reset (UTC)")}: {when(w.resetAt)}</span></div>
            <small className="muted">{stale || w.stale || (!cachedNewer && fresh.length > 0 && !isFresh) ? tr("Stale") : isFresh ? tr("Fresh") : tr("Cached")} · {w.fetchedAt ? `${tr("Updated (UTC)")}: ${when(w.fetchedAt)}` : tr("Time unknown")}</small>
            {!!w.models?.length && <details><summary>{tr("Models (")}{w.models.length})</summary>{w.models.join(", ")}</details>}
          </section>;
        };
        return <article className="quota-account" key={row.connectionId}>
          <header><div><h3>{row.name}</h3><span className="vendor-badge">{plan ?? tr("Plan unknown")}</span></div><button type="button" className="btn-ghost" disabled={busy || row.isActive === false || row.quotaSupported === false} onClick={() => onRefresh(row.connectionId)}>{status?.busy ? tr("Checking…") : tr("Check now")}</button></header>
          <div className={row.isActive === false ? "muted" : tokenTone(row.tokenStatus)}>{row.isActive === false && <>{tr("Disabled ·")} </>}{tr("Token")}: {tr(row.tokenStatus)}</div>
          {row.provider === "codebuddy-cn" && <>
            <div>{tr("Credit")}: {tr(row.creditStatus === "observed" ? (stale ? "Stale" : "Observed") : row.creditStatus === "stale" ? "Stale" : "Unknown")}</div>
            {row.accountCooldownUntil && <div>{tr("Account cooldown")}: {when(row.accountCooldownUntil)} (UTC)</div>}
            {!!row.modelCooldowns?.length && <details className="quota-more quota-cooldowns"><summary>{tr("Model cooldowns (this process only)")} ({row.modelCooldowns.length})</summary>{row.modelCooldowns.map((lock, i) => <div key={`${lock.model}:${i}`}>{lock.model} · {lock.reason} · {when(lock.until)} (UTC)</div>)}</details>}
          </>}
          <p className="quota-fetched muted">{stale ? tr("Stale") : fresh.length && !cachedNewer ? tr("Freshly checked") : tr("Cached")} · {fetched ? `${tr("Updated (UTC)")}: ${when(fetched)}` : tr("Never synced")}</p>
          {warning && <p className="bad" role="status">{warning}</p>}
          {row.quotaSupported === false ? <p className="muted">{tr("Upstream quota API unavailable")}</p> : windows.length === 0 ? <p className="muted">{row.fetchedAt ? tr("Quota unavailable") : tr("Not synced yet")}</p> : <>
            {windows.slice(0, 3).map(renderWindow)}
            {windows.length > 3 && <details className="quota-more"><summary>{tr("More quota windows")} ({windows.length - 3})</summary>{windows.slice(3).map(renderWindow)}</details>}
          </>}
        </article>;
      })}
    </div>
    {!result.total && <p className="muted">{tr("No matching accounts.")}</p>}
    <Pagination total={result.total} page={result.page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} itemLabel="accounts" />
  </>;
}

const asRecord = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** New observations replace only matching windows/models; retain unreported cached data. */
export function mergeWindows(cached: QuotaWindow[], fresh: QuotaWindow[]): QuotaWindow[] {
  const freshModels = new Set(fresh.flatMap(w => w.models ?? []));
  const freshKeys = new Set(fresh.map(w => w.key));
  const retained = cached.flatMap(w => {
    if (freshKeys.has(w.key) && !w.models?.length) return [];
    if (!w.models?.length) return [w];
    const models = w.models.filter(m => !freshModels.has(m));
    return models.length ? [{ ...w, key: freshKeys.has(w.key) ? `${w.key}:cached` : w.key, models }] : [];
  });
  return [...fresh, ...retained];
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
    const unknownFraction = (provider === "antigravity" || provider === "agy") && o.fractionReported === false;
    const used = unknownFraction ? null : n(o.used);
    const total = unknownFraction ? null : n(o.total);
    const remaining = unknownFraction ? null : n(o.remaining);
    let pct = unknownFraction ? null : n(o.remainingPercentage);
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
      const groupKey = `${fam.id}:${total ?? -1}:${used ?? -1}:${remaining ?? -1}:${pct ?? -1}:${resetAt ?? ""}:${unlimited}`;
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

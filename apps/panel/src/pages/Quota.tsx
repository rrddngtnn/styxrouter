import { Fragment, useMemo, useState } from "react";
import { api } from "../lib/api.ts";
import { Meter } from "../lib/charts.tsx";
import { DASH, ago, int, providerLabel, resetText } from "../lib/format.ts";
import type { ProviderInfo, QuotaRow, QuotaWindow } from "../lib/types.ts";
import { useFetch } from "../lib/useFetch.ts";
import { useNow } from "../lib/useNow.ts";

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

  const groups = useMemo(() => {
    const by = new Map<string, QuotaRow[]>();
    for (const r of state.status === "ok" ? state.data.providers ?? [] : []) {
      by.set(r.provider, [...(by.get(r.provider) ?? []), r]);
    }
    return [...by.entries()].sort(([a], [b]) => providerLabel(a, names).localeCompare(providerLabel(b, names)));
  }, [state, names]);

  async function refresh(id: string) {
    setLive((l) => ({ ...l, [id]: { busy: true } }));
    try {
      const data = await api.get<unknown>(`/api/usage/${id}`);
      setLive((l) => ({ ...l, [id]: { data } }));
      state.reload();
    } catch (e) {
      setLive((l) => ({ ...l, [id]: { error: e instanceof Error ? e.message : String(e) } }));
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
      setSyncSummary(`Synced ${res?.succeeded ?? 0}/${res?.total ?? 0} accounts${res?.failed ? ` (${res.failed} failed)` : ""}.`);
      state.reload();
    } catch (e) {
      setSyncSummary(`Sync failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSyncingAll(false);
    }
  }

  return (
    <div className="page">
      <h1>Quota</h1>
      <p className="muted">
        Every quota window per account (model family, 5-hour session, weekly, or billing allowance) with live reset countdowns.
        <b> Sync all quotas</b> refreshes every supported account; <b>Check now</b> queries one account on demand.
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
      {state.status === "ok" && groups.length === 0 && <p className="muted">No accounts connected.</p>}
      {groups.map(([provider, rows]) => {
        const anySupported = rows.some((r) => r.quotaSupported !== false && r.isActive !== false);
        return (
          <section className="panel-section" key={provider}>
            <div className="section-head">
              <h2>{providerLabel(provider, names)} <span className="tab-count">{rows.length}</span></h2>
              {anySupported && (
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={Object.values(live).some((l) => l.busy) || syncingAll}
                  onClick={() => checkGroup(rows)}
                >
                  Check all {rows.filter((r) => r.quotaSupported !== false && r.isActive !== false).length}
                </button>
              )}
            </div>
            <table className="table fixed">
              <colgroup>
                <col style={{ width: "22%" }} />
                <col style={{ width: "44%" }} />
                <col style={{ width: "13%" }} />
                <col style={{ width: "11%" }} />
                <col style={{ width: "10%" }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Quota windows (remaining · used / limit · resets in)</th>
                  <th>Last synced</th>
                  <th>Login</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const l = live[r.connectionId];
                  const liveWindows = l?.data !== undefined ? toWindows(r.provider, l.data) : null;
                  const windows = liveWindows && liveWindows.length > 0 ? liveWindows : r.windows ?? [];
                  const supported = r.quotaSupported !== false;
                  const disabled = r.isActive === false;
                  return (
                    <Fragment key={r.connectionId}>
                      <tr className={disabled ? "row-off" : ""}>
                        <td>
                          <div>{r.name}</div>
                          <div className="row-actions" style={{ marginTop: 4 }}>
                            {r.plan && <span className="vendor-badge">{r.plan}</span>}
                            {disabled && <span className="bad">disabled</span>}
                          </div>
                        </td>
                        <td>
                          {!supported ? (
                            <span className="muted">Custom / local endpoint — no upstream quota API</span>
                          ) : windows.length > 0 ? (
                            <div style={{ display: "grid", gap: "6px" }}>
                              {windows.map((w) => {
                                const pct = w.percentRemaining;
                                return (
                                  <div
                                    key={w.key}
                                    style={{
                                      display: "grid",
                                      gridTemplateColumns: "minmax(115px, 1.1fr) minmax(90px, 1fr) minmax(110px, 1.1fr) minmax(85px, 0.8fr)",
                                      gap: "8px",
                                      alignItems: "center",
                                      fontSize: "12px",
                                    }}
                                  >
                                    <span><code>{w.label}</code></span>
                                    <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                      {pct != null ? (
                                        <>
                                          <Meter value={pct} />
                                          <small style={{ minWidth: "36px", textAlign: "right" }}>{fmtPct(pct)}</small>
                                        </>
                                      ) : (
                                        <span className="muted">{DASH}</span>
                                      )}
                                    </span>
                                    <span className="muted">{fmtUsedLimit(w)}</span>
                                    <span className="muted">{resetText(w.resetAt, now)}</span>
                                  </div>
                                );
                              })}
                            </div>
                          ) : r.message ? (
                            <span className="bad">{r.message}</span>
                          ) : r.quotaTotal != null || r.percentRemaining < 100 ? (
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                              <Meter value={r.percentRemaining} />
                              <small>{fmtPct(r.percentRemaining)}</small>
                              <span className="muted">
                                {r.quotaTotal != null ? `${int(r.quotaUsed)} / ${int(r.quotaTotal)}` : ""}
                                {r.resetAt ? ` · ${resetText(r.resetAt, now)}` : ""}
                              </span>
                            </div>
                          ) : (
                            <span className="muted">not synced yet — click Check now</span>
                          )}
                          {l?.error && <div className="bad" style={{ marginTop: 4 }}>{l.error}</div>}
                        </td>
                        <td className="muted" title={r.fetchedAt ?? undefined}>
                          {r.fetchedAt ? ago(r.fetchedAt, now) : DASH}
                        </td>
                        <td
                          className={tokenTone(r.tokenStatus)}
                          title={
                            r.tokenStatus === "refreshable"
                              ? "The access token has run out; this account renews it on first use."
                              : undefined
                          }
                        >
                          {r.tokenStatus === "refreshable" ? "auto-refresh" : r.tokenStatus}
                        </td>
                        <td className="row-actions">
                          {supported ? (
                            <button type="button" className="btn-ghost" disabled={l?.busy || syncingAll} onClick={() => refresh(r.connectionId)}>
                              {l?.busy ? "..." : "Check now"}
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
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
      if (out.some((w) => w.key === groupKey)) continue;
      out.push({ key: groupKey, label: fam.label, used, total, remaining, percentRemaining: pct, resetAt, unlimited });
    } else {
      const label =
        rawKey === "session"
          ? "5h Session"
          : rawKey === "weekly"
            ? "Weekly"
            : typeof o.displayName === "string" && o.displayName.trim()
              ? o.displayName.trim()
              : rawKey;
      out.push({ key: rawKey, label, used, total, remaining, percentRemaining: pct, resetAt, unlimited });
    }
  }
  return out;
}

const tokenTone = (s: string) => (s === "valid" ? "ok" : s === "refreshable" || s === "expiring" || s === "refreshing" ? "muted" : "bad");

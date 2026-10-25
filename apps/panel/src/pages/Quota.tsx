import { Fragment, useMemo, useState } from "react";
import { api } from "../lib/api.ts";
import { Meter } from "../lib/charts.tsx";
import { DASH, countdown, int, providerLabel, resetText } from "../lib/format.ts";
import type { ProviderInfo, QuotaRow } from "../lib/types.ts";
import { useFetch } from "../lib/useFetch.ts";
import { useNow } from "../lib/useNow.ts";

type Live = { busy?: boolean; data?: unknown; error?: string };

export function Quota() {
  const now = useNow(1000);
  const state = useFetch<{ providers?: QuotaRow[] }>("/api/usage/quota");
  const provs = useFetch<{ providers?: ProviderInfo[] }>("/api/providers");
  const [live, setLive] = useState<Record<string, Live>>({});
  const names = new Map((provs.status === "ok" ? provs.data.providers ?? [] : []).map((p) => [p.id, p.name ?? p.id]));

  const groups = useMemo(() => {
    const by = new Map<string, QuotaRow[]>();
    for (const r of state.status === "ok" ? state.data.providers ?? [] : []) by.set(r.provider, [...(by.get(r.provider) ?? []), r]);
    return [...by.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [state]);

  async function refresh(id: string) {
    setLive((l) => ({ ...l, [id]: { busy: true } }));
    try {
      const data = await api.get<unknown>(`/api/usage/${id}`);
      setLive((l) => ({ ...l, [id]: { data } }));
    } catch (e) {
      setLive((l) => ({ ...l, [id]: { error: e instanceof Error ? e.message : String(e) } }));
    }
  }

  async function checkGroup(rows: QuotaRow[]) {
    if (!window.confirm(`Ask the provider about ${rows.length} account${rows.length === 1 ? "" : "s"}, one after another? This uses each account's login and may refresh its token.`)) return;
    for (const r of rows) await refresh(r.connectionId);
  }

  return (
    <div className="page">
      <h1>Quota</h1>
      <p className="muted">
        What the router knows about each account's allowance, with a live countdown to the reset. <b>Check now</b> asks the provider directly
        (it uses that account's login, and may refresh its token).
      </p>
      <div className="toolbar"><button type="button" className="btn-ghost" onClick={state.reload}>Reload</button></div>
      {state.status === "loading" && <p>Loading...</p>}
      {state.status === "error" && <p className="bad">{state.error.message}</p>}
      {state.status === "ok" && groups.length === 0 && <p className="muted">No accounts connected.</p>}
      {groups.map(([provider, rows]) => (
        <section className="panel-section" key={provider}>
          <div className="section-head">
            <h2>{providerLabel(provider, names)} <span className="tab-count">{rows.length}</span></h2>
            <button type="button" className="btn-ghost" disabled={Object.values(live).some((l) => l.busy)} onClick={() => checkGroup(rows)}>Check all {rows.length}</button>
          </div>
          <table className="table fixed">
            <colgroup><col style={{ width: "30%" }} /><col style={{ width: "26%" }} /><col style={{ width: "14%" }} /><col style={{ width: "12%" }} /><col style={{ width: "8%" }} /><col style={{ width: "10%" }} /></colgroup>
            <thead><tr><th>Account</th><th>Remaining</th><th>Used / limit</th><th>Resets in</th><th>Login</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => {
                const known = r.quotaTotal != null || r.percentRemaining < 100;
                const l = live[r.connectionId];
                return (
                  <Fragment key={r.connectionId}>
                    <tr>
                      <td>{r.name}</td>
                      <td className="grow">{known ? <><Meter value={r.percentRemaining} /> <small>{Math.round(r.percentRemaining)}%</small></> : <span className="muted">no data yet</span>}</td>
                      <td>{r.quotaTotal != null ? `${int(r.quotaUsed)} / ${int(r.quotaTotal)}` : DASH}</td>
                      <td>{resetText(r.resetAt, now)}</td>
                      <td className={r.tokenStatus === "valid" ? "ok" : "bad"}>{r.tokenStatus}</td>
                      <td className="row-actions"><button type="button" className="btn-ghost" disabled={l?.busy} onClick={() => refresh(r.connectionId)}>{l?.busy ? "..." : "Check now"}</button></td>
                    </tr>
                    {(l?.data !== undefined || l?.error) && (
                      <tr key={`${r.connectionId}-live`}>
                        <td colSpan={6}>{l.error ? <span className="bad">{l.error}</span> : <LiveQuota data={l.data} now={now} />}</td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}

interface Window { name: string; used?: number; total?: number; remaining?: number; pct?: number; resetAt?: string }

/** Providers answer in slightly different shapes; show the windows we can recognise, otherwise the raw reply. */
function LiveQuota({ data, now }: { data: unknown; now: number }) {
  const windows = toWindows(data);
  if (windows.length === 0) return <pre className="json">{JSON.stringify(data, null, 2).slice(0, 1500)}</pre>;
  return (
    <table className="table">
      <tbody>
        {windows.map((w) => (
          <tr key={w.name}>
            <td>{w.name}</td>
            <td className="grow">{w.pct != null ? <Meter value={w.pct} /> : null}</td>
            <td>{w.used != null && w.total != null ? `${int(w.used)} / ${int(w.total)}` : w.remaining != null ? `${int(w.remaining)} left` : DASH}</td>
            <td>{w.resetAt ? `resets in ${countdown(w.resetAt, now)}` : DASH}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function toWindows(data: unknown): Window[] {
  const q = (data as { quotas?: unknown } | null)?.quotas;
  const entries: [string, unknown][] = Array.isArray(q) ? q.map((v, i) => [String((v as { name?: string })?.name ?? `window ${i + 1}`), v]) : q && typeof q === "object" ? Object.entries(q) : [];
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  return entries
    .filter(([, v]) => v && typeof v === "object")
    .map(([name, v]) => {
      const o = v as Record<string, unknown>;
      const used = n(o.used);
      const total = n(o.total);
      const remaining = n(o.remaining);
      const pct = n(o.remainingPercentage) ?? (used != null && total ? Math.max(0, 100 - (used / total) * 100) : undefined);
      return { name, used, total, remaining, pct, resetAt: typeof o.resetAt === "string" ? o.resetAt : undefined };
    });
}


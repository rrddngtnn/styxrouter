import { Link } from "react-router-dom";
import { api } from "../lib/api.ts";
import { useAction } from "../lib/actions.tsx";
import { BarChart, Meter, Stat } from "../lib/charts.tsx";
import { DASH, ago, int, num, pctText, providerLabel, resetText, usd } from "../lib/format.ts";
import { accountProblem, type Analytics, type BackupRow, type Connection, type ProviderInfo, type QuotaRow } from "../lib/types.ts";
import { useFetch } from "../lib/useFetch.ts";
import { useNow } from "../lib/useNow.ts";

export function Dashboard() {
  const now = useNow(30000);
  const health = useFetch<{ ok: boolean; version?: string; uptime_seconds?: number }>("/api/health/ping");
  const stats = useFetch<Analytics>("/api/usage/analytics?range=7d");
  const conns = useFetch<{ connections?: Connection[] }>("/api/connections");
  const provs = useFetch<{ providers?: ProviderInfo[] }>("/api/providers");
  const quota = useFetch<{ providers?: QuotaRow[] }>("/api/usage/quota");
  const backups = useFetch<{ backups?: BackupRow[] }>("/api/backups");
  const { busy, error, run } = useAction(backups.reload);

  const names = new Map((provs.status === "ok" ? provs.data.providers ?? [] : []).map((p) => [p.id, p.name ?? p.id]));
  const accounts = conns.status === "ok" ? conns.data.connections ?? [] : [];
  const problems = accounts.map((c) => ({ c, why: accountProblem(c, now) })).filter((x) => x.why);
  const active = accounts.filter((c) => c.isActive).length;
  const s = stats.status === "ok" ? stats.data.summary : null;
  const lowQuota = (quota.status === "ok" ? quota.data.providers ?? [] : [])
    .filter((q) => q.quotaTotal != null || q.percentRemaining < 100)
    .sort((a, b) => a.percentRemaining - b.percentRemaining)
    .slice(0, 5);
  const lastBackup = backups.status === "ok" ? backups.data.backups?.[0] : undefined;

  return (
    <div className="page">
      <h1>Overview</h1>
      <div className="cards">
        <Stat label="Health" value={health.status === "ok" ? (health.data.ok ? "OK" : "DOWN") : health.status === "error" ? "unreachable" : "..."} tone={health.status === "ok" && health.data.ok ? "ok" : "bad"} sub={health.status === "ok" && health.data.version ? `v${health.data.version}` : undefined} />
        <Stat label="Requests (7d)" value={int(s?.totalRequests)} sub={s ? `${pctText(s.successRatePct)} succeeded` : undefined} />
        <Stat label="Tokens (7d)" value={num(s?.totalTokens)} sub={s ? `${num(s.promptTokens)} in / ${num(s.completionTokens)} out` : undefined} />
        <Stat label="Est. cost (7d)" value={usd(s?.totalCost)} sub="indicative only" />
        <Stat label="Accounts" value={`${active}/${accounts.length}`} sub={problems.length ? `${problems.length} need attention` : "all healthy"} tone={problems.length ? "bad" : "ok"} />
      </div>

      <section className="panel-section">
        <h2>Requests per day</h2>
        {stats.status === "ok" && <BarChart data={stats.data.dailyTrend.map((d) => ({ label: d.date.slice(5), value: d.requests }))} format={int} />}
        {stats.status === "loading" && <p className="muted">Loading...</p>}
        {stats.status === "error" && <p className="bad">{stats.error.message}</p>}
      </section>

      <div className="two-col">
        <section className="panel-section">
          <h2>Needs attention</h2>
          {problems.length === 0 ? (
            <p className="muted">Every active account passed its last check.</p>
          ) : (
            <table className="table">
              <tbody>
                {problems.slice(0, 8).map(({ c, why }) => (
                  <tr key={c.id}>
                    <td>{providerLabel(c.provider, names)}</td>
                    <td>{c.name ?? c.id.slice(0, 8)}</td>
                    <td className="bad">{why}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {problems.length > 8 && <p className="muted">and {problems.length - 8} more. <Link to="/providers">See all</Link></p>}
        </section>

        <section className="panel-section">
          <h2>Lowest quota</h2>
          {lowQuota.length === 0 ? (
            <p className="muted">No quota information yet. <Link to="/quota">Open Quota</Link></p>
          ) : (
            <table className="table">
              <tbody>
                {lowQuota.map((q) => (
                  <tr key={q.connectionId}>
                    <td>{q.name}</td>
                    <td className="grow"><Meter value={q.percentRemaining} /></td>
                    <td>{Math.round(q.percentRemaining)}%</td>
                    <td className="muted">{q.resetAt ? (Date.parse(q.resetAt) <= now ? "already reset" : `resets in ${resetText(q.resetAt, now)}`) : DASH}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <div className="two-col">
        <section className="panel-section">
          <h2>Top models (7d)</h2>
          {stats.status === "ok" && (
            <table className="table">
              <tbody>
                {stats.data.byModel.slice(0, 5).map((m) => (
                  <tr key={`${m.provider}/${m.model}`}>
                    <td><code>{m.model}</code></td>
                    <td className="muted">{m.provider}</td>
                    <td>{int(m.requests)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p><Link to="/usage">Full usage report</Link></p>
        </section>

        <section className="panel-section">
          <h2>Backups</h2>
          <p>{lastBackup ? <>Last backup {ago(lastBackup.createdAt, now)} <span className="muted">({lastBackup.reason})</span></> : "No backups yet."}</p>
          <p className="muted">A scheduled backup runs daily. The newest scheduled copies are kept; other snapshots are never deleted automatically.</p>
          {error && <p className="bad">{error}</p>}
          <button type="button" className="btn-add" disabled={busy !== null} onClick={() => run("backup", () => api.post("/api/backups"))}>
            {busy ? "..." : "Back up now"}
          </button>
        </section>
      </div>
    </div>
  );
}

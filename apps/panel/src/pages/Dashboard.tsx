import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { api } from "../lib/api.ts";
import { int, num, pctText, ms, usd, when } from "../lib/format.ts";
import { accountProblem, type Analytics, type Connection, type ProviderInfo } from "../lib/types.ts";
import { useFetch } from "../lib/useFetch.ts";
import { useNow } from "../lib/useNow.ts";
import { providerHealth } from "./dashboard-data.ts";
import { TrafficGraph, type ChartMetric } from "./dashboard-traffic.tsx";
import "./dashboard.css";

type State<T> = { status: string; data?: T | null; error?: Error | null };
interface Log { id: string; timestamp: string; model?: string; status?: number; duration?: number; error?: string | null }
interface Props {
  range: string; onRange: (range: string) => void; now: number;
  health: State<{ ok: boolean; uptime_seconds?: number }>; stats: State<Analytics>;
  conns: State<{ connections?: Connection[] }>; provs: State<{ providers?: ProviderInfo[] }>;
  nodes?: State<{ nodes?: { id: string; name: string; prefix: string | null }[] }>;
  logs: State<Log[]>;
  onRefresh?: () => void;
}
function statusMessage(state: State<unknown>) {
  return state.status === "error" ? <p role="alert" className="bad">{state.error?.message ?? "Data unavailable"}</p> : <p className="muted" role="status">Loading…</p>;
}
export function Dashboard() {
  const [range, setRange] = useState("7d");
  const health = useFetch<{ ok: boolean; uptime_seconds?: number }>("/api/health/ping");
  const stats = useFetch<Analytics>(`/api/usage/analytics?range=${range}`);
  const conns = useFetch<{ connections?: Connection[] }>("/api/connections");
  const provs = useFetch<{ providers?: ProviderInfo[] }>("/api/providers");
  const nodes = useFetch<{ nodes?: { id: string; name: string; prefix: string | null }[] }>("/api/provider-nodes");
  const logs = useFetch<Log[]>("/api/usage/call-logs?limit=10");
  const refreshAll = () => {
    health.reload();
    stats.reload();
    conns.reload();
    provs.reload();
    nodes.reload();
    logs.reload();
  };
  return <DashboardView range={range} onRange={setRange} now={useNow(30000)} health={health} stats={stats} conns={conns} provs={provs} nodes={nodes} logs={logs} onRefresh={refreshAll} />;
}
export function DashboardView({ range, onRange, now, health, stats, conns, provs, nodes, logs, onRefresh }: Props) {
  const [metric, setMetric] = useState<ChartMetric>("requests");
  const [busyId, setBusyId] = useState<string | null>(null);
  const accounts = conns.data?.connections ?? [];
  const names = new Map((provs.data?.providers ?? []).map(p => [p.id, p.name ?? p.id]));
  for (const n of nodes?.data?.nodes ?? []) {
    names.set(n.id, n.prefix ? `${n.name} (${n.prefix})` : n.name);
  }
  const pools = providerHealth(accounts, names, now);
  const problems = accounts.map(account => ({ account, reason: accountProblem(account, now) })).filter(p => p.reason);
  const summary = stats.status === "ok" ? stats.data?.summary : null;
  const topModels = stats.status === "ok" ? (stats.data?.byModel ?? []).slice(0, 6) : [];
  const maxModelReqs = Math.max(1, ...topModels.map(m => m.requests));

  async function releaseCooldown(id: string) {
    setBusyId(id);
    try {
      await api.post(`/api/connections/${encodeURIComponent(id)}/release-cooldown`);
      toast.success("Cooldown cleared");
      onRefresh?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  async function testAccount(id: string) {
    setBusyId(id);
    try {
      const res = await api.post<{ ok: boolean; error?: string | null }>(`/api/connections/${encodeURIComponent(id)}/test`);
      if (res.ok) toast.success("Account test passed");
      else toast.error(res.error ?? "Account test failed");
      onRefresh?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  return <div className="page dashboard-page">
    <div className="section-head">
      <div>
        <h1 style={{ marginBottom: 4 }}>Overview</h1>
        {health.status !== "ok" || !health.data?.ok ? (
          <span className={health.status === "ok" ? "bad" : "muted"}>
            {health.status === "ok" ? "Gateway unhealthy" : "Gateway status unavailable"}
          </span>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            Real-time gateway throughput, upstream account pools, and live model dispatch.
          </p>
        )}
      </div>
      <div className="row-actions">
        <div className="seg" aria-label="Time range">
          {["1d", "7d", "30d", "90d"].map(value => (
            <button key={value} type="button" aria-pressed={range === value} className={range === value ? "seg-on" : ""} onClick={() => onRange(value)}>
              {value}
            </button>
          ))}
        </div>
        {onRefresh && (
          <button type="button" className="btn-ghost" onClick={onRefresh} title="Refresh overview">
            <RefreshCw size={14} />
            <span>Refresh</span>
          </button>
        )}
      </div>
    </div>
    {health.status === "error" && statusMessage(health)}
    <dl className="dashboard-summary">
      <div><dt>Requests · {range}</dt><dd>{summary ? int(summary.totalRequests) : "—"}</dd><small className="muted">{summary ? `${usd(summary.totalCost)} est. cost` : "\u00a0"}</small></div>
      <div><dt>Tokens</dt><dd>{summary ? num(summary.totalTokens) : "—"}</dd><small className="muted">{summary ? `${num(summary.promptTokens)} in · ${num(summary.completionTokens)} out` : "\u00a0"}</small></div>
      <div><dt>Success rate</dt><dd>{summary ? pctText(summary.successRatePct) : "—"}</dd><small className="muted">{summary ? `${int(Math.max(0, summary.totalRequests - Math.round(summary.totalRequests * (summary.successRatePct / 100))))} failed` : "\u00a0"}</small></div>
      <div><dt>Average latency</dt><dd>{summary ? ms(summary.avgLatencyMs) : "—"}</dd><small className="muted">end-to-end dispatch</small></div>
      <div><dt>Accounts enabled</dt><dd>{conns.status === "ok" ? `${accounts.filter(a => a.isActive).length}/${accounts.length}` : "—"}</dd><small className={problems.length > 0 ? "bad" : "muted"}>{conns.status === "ok" ? (problems.length > 0 ? `${problems.length} needing attention` : `${pools.length} provider pools`) : "\u00a0"}</small></div>
    </dl>
    <div className="dashboard-primary">
      <section className="dashboard-region">
        <div className="section-head">
          <h2>Traffic</h2>
          <div className="row-actions">
            <div className="seg" role="group" aria-label="Chart metric">
              {(["requests", "totalTokens", "cost"] as const).map(m => (
                <button key={m} type="button" className={metric === m ? "seg-on" : ""} onClick={() => setMetric(m)}>
                  {m === "totalTokens" ? "tokens" : m}
                </button>
              ))}
            </div>
            <Link to="/usage">Usage report →</Link>
          </div>
        </div>
        {stats.status === "ok" ? <TrafficGraph days={stats.data?.dailyTrend ?? []} metric={metric} /> : statusMessage(stats)}
      </section>
      <section className="dashboard-region">
        <div className="section-head"><h2>Provider health</h2><Link to="/providers">Manage →</Link></div>
        {conns.status !== "ok" ? statusMessage(conns) : pools.length ? (
          <ul className="dashboard-list">
            {pools.map(pool => {
              const pct = pool.active > 0 ? Math.round(((pool.healthy + pool.unchecked) / pool.active) * 100) : 0;
              const barTone = pool.problems ? "bad" : pool.healthy > 0 ? "ok" : pool.unchecked > 0 ? "warn" : "ok";
              return (
                <li key={pool.id}>
                  <div className="section-head" style={{ marginBottom: 2 }}>
                    <Link to={`/providers/${encodeURIComponent(pool.id)}`}><strong>{pool.name}</strong></Link>
                    <small>{pool.active}/{pool.total} enabled</small>
                  </div>
                  <span className={pool.problems ? "bad" : "muted"}>
                    {pool.healthy} checked healthy · {pool.unchecked} unchecked{pool.problems ? ` · ${pool.problems} problems` : ""}
                  </span>
                  <div className="meter" style={{ marginTop: 4 }}>
                    <div className={`meter-fill ${barTone}`} style={{ width: `${pool.active === 0 ? 0 : Math.max(8, pct)}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        ) : <p className="muted">Connect a provider to start routing requests.</p>}
      </section>
    </div>
    <div className="dashboard-secondary">
      <section className="dashboard-region">
        <div className="section-head"><h2>Recent activity</h2><Link to="/activity?errors=true">View errors →</Link></div>
        {logs.status !== "ok" ? statusMessage(logs) : logs.data?.length ? (
          <ul className="dashboard-list">
            {logs.data.slice(0, 6).map(log => (
              <li key={log.id}>
                <div className="section-head" style={{ marginBottom: 0 }}>
                  <Link to={`/activity?q=${encodeURIComponent(log.model ?? "")}`} style={{ textDecoration: "none" }}>
                    <code>{log.model ?? "Unknown model"}</code>
                  </Link>
                  <Link className={log.status && log.status >= 400 ? "bad" : "ok"} to={log.status && log.status >= 400 ? "/activity?errors=true" : "/activity"}>
                    {log.status ?? "—"}
                  </Link>
                </div>
                <small>{when(log.timestamp)} · {ms(log.duration)}</small>
              </li>
            ))}
          </ul>
        ) : <p className="muted">No recent requests</p>}
      </section>

      <section className="dashboard-region">
        <div className="section-head"><h2>Top models · {range}</h2><Link to="/models">Catalog →</Link></div>
        {stats.status !== "ok" ? statusMessage(stats) : topModels.length ? (
          <ul className="dashboard-list">
            {topModels.map(m => {
              const widthPct = Math.max(4, Math.round((m.requests / maxModelReqs) * 100));
              return (
                <li key={`${m.provider}-${m.model}`}>
                  <div className="section-head" style={{ marginBottom: 2 }}>
                    <Link to={`/activity?q=${encodeURIComponent(m.model)}`} style={{ textDecoration: "none" }}>
                      <code>{m.model}</code>
                    </Link>
                    <small>{int(m.requests)} req · {num(m.totalTokens)} tok</small>
                  </div>
                  <div className="meter">
                    <div className="meter-fill ok" style={{ width: `${widthPct}%`, background: "var(--accent-bright)" }} />
                  </div>
                </li>
              );
            })}
          </ul>
        ) : <p className="muted">No model usage recorded in this range.</p>}
      </section>

      <section className="dashboard-region">
        <div className="section-head"><h2>Account problems</h2><Link to="/quota">Quotas →</Link></div>
        {conns.status !== "ok" ? statusMessage(conns) : problems.length ? (
          <ul className="dashboard-list">
            {problems.slice(0, 6).map(({ account, reason }) => (
              <li key={account.id}>
                <div className="section-head" style={{ marginBottom: 2 }}>
                  <Link to={`/providers/${encodeURIComponent(account.provider)}`}>{account.name ?? account.id}</Link>
                  <div className="row-actions" style={{ gap: 4 }}>
                    <button type="button" className="btn-ghost" style={{ padding: "2px 7px", fontSize: 11 }} disabled={busyId !== null} onClick={() => void releaseCooldown(account.id)}>
                      Clear
                    </button>
                    <button type="button" className="btn-ghost" style={{ padding: "2px 7px", fontSize: 11 }} disabled={busyId !== null} onClick={() => void testAccount(account.id)}>
                      Test
                    </button>
                  </div>
                </div>
                <span className="bad">{reason}</span>
              </li>
            ))}
          </ul>
        ) : <p className="muted">No account problems reported. Unchecked accounts are listed in provider health.</p>}
      </section>
    </div>
  </div>;
}

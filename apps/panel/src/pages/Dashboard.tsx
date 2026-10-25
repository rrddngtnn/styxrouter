import { useState } from "react";
import { Link } from "react-router-dom";
import { int, num, pctText, ms, when } from "../lib/format.ts";
import { accountProblem, type Analytics, type Connection, type ProviderInfo } from "../lib/types.ts";
import { useFetch } from "../lib/useFetch.ts";
import { useNow } from "../lib/useNow.ts";
import { providerHealth } from "./dashboard-data.ts";
import { TrafficGraph } from "./dashboard-traffic.tsx";
import "./dashboard.css";

type State<T> = { status: string; data?: T | null; error?: Error | null };
interface Log { id: string; timestamp: string; model?: string; status?: number; duration?: number }
interface Props {
  range: string; onRange: (range: string) => void; now: number;
  health: State<{ ok: boolean }>; stats: State<Analytics>;
  conns: State<{ connections?: Connection[] }>; provs: State<{ providers?: ProviderInfo[] }>;
  nodes?: State<{ nodes?: { id: string; name: string; prefix: string | null }[] }>;
  logs: State<Log[]>;
}
function statusMessage(state: State<unknown>) {
  return state.status === "error" ? <p role="alert" className="bad">{state.error?.message ?? "Data unavailable"}</p> : <p className="muted" role="status">Loading…</p>;
}
export function Dashboard() {
  const [range, setRange] = useState("7d");
  const health = useFetch<{ ok: boolean }>("/api/health/ping");
  const stats = useFetch<Analytics>(`/api/usage/analytics?range=${range}`);
  const conns = useFetch<{ connections?: Connection[] }>("/api/connections");
  const provs = useFetch<{ providers?: ProviderInfo[] }>("/api/providers");
  const nodes = useFetch<{ nodes?: { id: string; name: string; prefix: string | null }[] }>("/api/provider-nodes");
  const logs = useFetch<Log[]>("/api/usage/call-logs?limit=8");
  return <DashboardView range={range} onRange={setRange} now={useNow(30000)} health={health} stats={stats} conns={conns} provs={provs} nodes={nodes} logs={logs} />;
}
export function DashboardView({ range, onRange, now, health, stats, conns, provs, nodes, logs }: Props) {
  const accounts = conns.data?.connections ?? [];
  const names = new Map((provs.data?.providers ?? []).map(p => [p.id, p.name ?? p.id]));
  for (const n of nodes?.data?.nodes ?? []) {
    names.set(n.id, n.prefix ? `${n.name} (${n.prefix})` : n.name);
  }
  const pools = providerHealth(accounts, names, now);
  const problems = accounts.map(account => ({ account, reason: accountProblem(account, now) })).filter(p => p.reason);
  const summary = stats.status === "ok" ? stats.data?.summary : null;
  return <div className="page dashboard-page">
    <div className="section-head"><div><h1>Overview</h1><span className={health.status === "ok" ? health.data?.ok ? "ok" : "bad" : "muted"}>{health.status === "ok" ? health.data?.ok ? "Gateway online" : "Gateway unhealthy" : "Gateway status unavailable"}</span></div><div className="seg" aria-label="Time range">{["1d", "7d", "30d", "90d"].map(value => <button key={value} aria-pressed={range === value} className={range === value ? "seg-on" : ""} onClick={() => onRange(value)}>{value}</button>)}</div></div>
    {health.status === "error" && statusMessage(health)}
    <dl className="dashboard-summary">
      <div><dt>Requests · {range}</dt><dd>{summary ? int(summary.totalRequests) : "—"}</dd></div>
      <div><dt>Tokens</dt><dd>{summary ? num(summary.totalTokens) : "—"}</dd></div>
      <div><dt>Success rate</dt><dd>{summary ? pctText(summary.successRatePct) : "—"}</dd></div>
      <div><dt>Average latency</dt><dd>{summary ? ms(summary.avgLatencyMs) : "—"}</dd></div>
      <div><dt>Accounts enabled</dt><dd>{conns.status === "ok" ? `${accounts.filter(a => a.isActive).length}/${accounts.length}` : "—"}</dd></div>
    </dl>
    <div className="dashboard-primary">
      <section className="dashboard-region"><div className="section-head"><h2>Traffic</h2><Link to="/usage">Usage report →</Link></div>{stats.status === "ok" ? <TrafficGraph days={stats.data?.dailyTrend ?? []} /> : statusMessage(stats)}</section>
      <section className="dashboard-region"><div className="section-head"><h2>Provider health</h2><Link to="/providers">Manage →</Link></div>{conns.status !== "ok" ? statusMessage(conns) : pools.length ? <ul className="dashboard-list">{pools.map(pool => <li key={pool.id}><Link to={`/providers/${encodeURIComponent(pool.id)}`}>{pool.name}</Link><span className={pool.problems ? "bad" : "muted"}>{pool.healthy} checked healthy · {pool.unchecked} unchecked{pool.problems ? ` · ${pool.problems} problems` : ""}</span><small>{pool.active}/{pool.total} enabled</small></li>)}</ul> : <p className="muted">Connect a provider to start routing requests.</p>}</section>
    </div>
    <div className="dashboard-secondary">
      <section className="dashboard-region"><div className="section-head"><h2>Recent activity</h2><Link to="/activity?errors=true">View errors →</Link></div>{logs.status !== "ok" ? statusMessage(logs) : logs.data?.length ? <ul className="dashboard-list">{logs.data.slice(0,8).map(log => <li key={log.id}><div className="section-head"><code>{log.model ?? "Unknown model"}</code><Link className={log.status && log.status >= 400 ? "bad" : "muted"} to={log.status && log.status >= 400 ? "/activity?errors=true" : "/activity"}>{log.status ?? "Unknown status"}</Link></div><small>{when(log.timestamp)} · {ms(log.duration)}</small></li>)}</ul> : <p className="muted">No recent requests</p>}</section>
      <section className="dashboard-region"><h2>Account problems</h2>{conns.status !== "ok" ? statusMessage(conns) : problems.length ? <ul className="dashboard-list">{problems.slice(0,8).map(({account,reason}) => <li key={account.id}><Link to={`/providers/${encodeURIComponent(account.provider)}`}>{account.name ?? account.id}</Link><span className="bad">{reason}</span></li>)}</ul> : <p className="muted">No account problems reported. Unchecked accounts are listed in provider health.</p>}</section>
    </div>
  </div>;
}

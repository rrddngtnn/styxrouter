import { useTranslator } from "../lib/useTranslator.ts";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ProviderIcon } from "../components/ProviderIcon.tsx";
import { Download } from "lucide-react";
import { LoadingState } from "../components/PageStates.tsx";
import { TableScroll } from "../components/TableScroll.tsx";
import { BarChart, Stat } from "../lib/charts.tsx";
import { DASH, downloadCsv, int, ms, num, pctText, providerLabel, usd, when } from "../lib/format.ts";
import type { Analytics, Day } from "../lib/types.ts";
import { useFetch } from "../lib/useFetch.ts";


const RANGES = ["1d", "7d", "30d", "90d", "365d", "all"] as const;
type Range = (typeof RANGES)[number];
type Metric = "requests" | "totalTokens" | "cost";

export function Usage() {
  const tr = useTranslator();
  const [range, setRange] = useState<Range>("30d");
  const [metric, setMetric] = useState<Metric>("requests");
  const [provider, setProvider] = useState("");
  const allProviders = useFetch<Analytics>(`/api/usage/analytics?range=${range}`);
  const state = useFetch<Analytics>(provider ? `/api/usage/analytics?range=${range}&provider=${encodeURIComponent(provider)}` : null);
  const activeState = provider ? state : allProviders;
  const a = activeState.status === "ok" && (activeState.data.range ?? range) === range && (activeState.data.provider ?? "") === provider ? activeState.data : null;
  const provs = useFetch<{ providers?: { id: string; name?: string }[] }>("/api/providers");
  const nodes = useFetch<{ nodes?: { id: string; name: string; prefix: string | null }[] }>("/api/provider-nodes");
  const names = useMemo(() => {
    const map = new Map((provs.status === "ok" ? provs.data.providers ?? [] : []).map((p) => [p.id, p.name ?? p.id]));
    for (const n of nodes.data?.nodes ?? []) {
      map.set(n.id, n.prefix ? `${n.name} (${n.prefix})` : n.name);
    }
    return map;
  }, [provs.status, provs.data, nodes.data]);
  const label = (id: string) => providerLabel(id, names);
  const csvScope = provider ? `provider-${encodeURIComponent(provider)}` : "all-providers";

  const months = useMemo(() => {
    const by = new Map<string, { requests: number; tokens: number; cost: number }>();
    for (const d of a?.dailyTrend ?? []) {
      const m = by.get(d.date.slice(0, 7)) ?? { requests: 0, tokens: 0, cost: 0 };
      m.requests += d.requests;
      m.tokens += d.totalTokens;
      m.cost += d.cost;
      by.set(d.date.slice(0, 7), m);
    }
    return [...by.entries()].sort(([x], [y]) => y.localeCompare(x));
  }, [a]);

  const series = (d: Day) => (metric === "requests" ? d.requests : metric === "cost" ? d.cost : d.totalTokens);
  const fmt = metric === "requests" ? int : metric === "cost" ? usd : num;

  return (
    <div className="page">
      <div className="section-head" style={{ marginBottom: 16 }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>{tr("Usage")}</h1>
          <p className="muted" style={{ margin: 0 }}>{tr("Request volume, token consumption, latency, and estimated cost across providers, models, and client keys.")}</p>
        </div>
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <label>{tr("Provider")}{" "}<select aria-label={tr("Provider")} value={provider} onChange={(event) => setProvider(event.target.value)}>
            <option value="">{tr("All providers")}</option>
            {(allProviders.data?.byProvider ?? []).map((p) => { const pid = p.providerId ?? p.provider; return <option key={pid} value={pid}>{label(pid)}</option>; })}
          </select></label>
          <div className="seg" role="group" aria-label={tr("Range")}>
            {RANGES.map((r) => (
              <button key={r} type="button" className={r === range ? "seg-on" : ""} onClick={() => setRange(r)}>
                {r}
              </button>
            ))}
          </div>
          <div className="seg" role="group" aria-label={tr("Metric")}>
            {(["requests", "totalTokens", "cost"] as const).map((m) => (
              <button key={m} type="button" className={m === metric ? "seg-on" : ""} onClick={() => setMetric(m)}>
                {tr(m === "totalTokens" ? "tokens" : m)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {(activeState.status === "loading" || (activeState.status === "ok" && !a)) && <LoadingState label={tr("Loading usage analytics")} />}
      {activeState.status === "error" && <p className="bad">{activeState.error.message}</p>}
      {a && (
        <>
          <div className="cards">
            <Stat label={tr("Requests")} value={int(a.summary.totalRequests)} sub={tr("{0} succeeded", {0: String(pctText(a.summary.successRatePct))})} />
            <Stat label={tr("Input tokens")} value={num(a.summary.promptTokens)} />
            <Stat label={tr("Output tokens")} value={num(a.summary.completionTokens)} />
            <Stat label={tr("Avg latency")} value={ms(a.summary.avgLatencyMs)} />
            <Stat label={tr("Est. cost")} value={usd(a.summary.totalCost)} sub={tr("indicative only")} />
          </div>

          <section className="card" style={{ marginBottom: 20 }}>
            <h2 style={{ marginTop: 0 }}>{tr("Daily trend (")}{tr(metric === "totalTokens" ? "tokens" : metric)})</h2>
            <BarChart data={a.dailyTrend.map((d) => ({ label: d.date.slice(5), title: `${d.date}: ${fmt(series(d))}`, value: series(d) }))} format={fmt} interactive />
          </section>

          <section className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 20 }}>
            <div className="section-head" style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
              <div><h2 style={{ margin: 0 }}>{tr("By provider")}</h2><small className="muted">{tr("Provider")}: {provider ? label(provider) : tr("All providers")}</small></div>
              <button
                type="button"
                className="btn-ghost"
                onClick={() =>
                  downloadCsv(
                    `usage-by-provider-${range}-${csvScope}.csv`,
                    ["provider", "requests", "tokens", "avg_latency_ms", "success_pct", "est_cost_usd"],
                    a.byProvider.map((p) => [label(p.provider), p.requests, p.totalTokens, p.avgLatencyMs, p.successRatePct, p.cost]),
                  )
                }
              >
                <Download size={13} />
                <span>CSV</span>
              </button>
            </div>
            <TableScroll label={tr("Usage by provider table")} stickyPrimary><table className="table">
              <thead><tr>{[tr("Provider"), tr("Requests"), tr("Tokens"), tr("Latency"), tr("Success"), tr("Cost"), tr("Accounts")].map(h => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>{a.byProvider.map(p => { const pid = p.providerId ?? p.provider; return <tr key={pid} onClick={(event) => { if (!(event.target as HTMLElement).closest('a,button')) setProvider(pid); }} style={{ cursor: "pointer" }}>
                <td><button type="button" className="btn-ghost" aria-label={`${tr("Focus")} ${p.provider}`} aria-pressed={provider === pid} onClick={() => setProvider(pid)}><ProviderIcon providerId={pid} label={p.provider} size={24} /> {p.provider}</button></td>
                <td>{int(p.requests)}</td><td>{num(p.totalTokens)}</td><td>{ms(p.avgLatencyMs)}</td><td>{pctText(p.successRatePct)}</td><td>{usd(p.cost)}</td>
                <td><Link to={`/providers/${encodeURIComponent(pid)}?tab=accounts`} aria-label={`${tr("Accounts")} ${p.provider}`}>{tr("Accounts")}</Link></td>
              </tr>; })}</tbody>
            </table></TableScroll>
          </section>

          <section className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 20 }}>
            <div className="section-head" style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
              <h2 style={{ margin: 0 }}>{tr("By model")}</h2>
              <button
                type="button"
                className="btn-ghost"
                onClick={() =>
                  downloadCsv(
                    `usage-by-model-${range}-${csvScope}.csv`,
                    ["model", "provider", "requests", "tokens", "avg_latency_ms", "success_pct", "est_cost_usd"],
                    a.byModel.map((m) => [m.model, label(m.provider), m.requests, m.totalTokens, m.avgLatencyMs, m.successRatePct, m.cost]),
                  )
                }
              >
                <Download size={13} />
                <span>CSV</span>
              </button>
            </div>
            <Table
              label={tr("Usage by model table")}
              head={[tr("Model"), tr("Provider"), tr("Requests"), tr("Tokens"), tr("Latency"), tr("Success"), tr("Cost")]}
              rows={a.byModel.map((m) => [m.model, label(m.provider), int(m.requests), num(m.totalTokens), ms(m.avgLatencyMs), pctText(m.successRatePct), usd(m.cost)])}
            />
          </section>

          <div className="two-col" style={{ marginBottom: 20 }}>
            <section className="card" style={{ padding: 0, overflow: "hidden" }}>
              <div className="section-head" style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
                <h2 style={{ margin: 0 }}>{tr("By account")}</h2>
                {a.byAccount.length > 15 && <span className="muted" style={{ fontSize: 14 }}>{tr("Top 15 of")}{a.byAccount.length}</span>}
              </div>
              <p className="muted" style={{ padding: "10px 16px", margin: 0 }}>{tr("Retained raw records only; older daily summaries cannot be attributed to accounts, so these totals may be incomplete.")}</p>
              <Table
                label={tr("Usage by account table")}
                head={[tr("Account"), tr("Requests"), tr("Tokens"), tr("Last used")]}
                rows={a.byAccount.slice(0, 15).map((x) => [x.account, int(x.requests), num(x.totalTokens), when(x.lastUsed)])}
              />
            </section>
            <div style={{ display: "grid", gap: 20, alignContent: "start" }}>
              <section className="card" style={{ padding: 0, overflow: "hidden" }}>
                <div className="section-head" style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
                  <h2 style={{ margin: 0 }}>{tr("By API key")}</h2>
                </div>
                <p className="muted" style={{ padding: "10px 16px", margin: 0 }}>{tr("Retained raw records only; older daily summaries cannot be attributed to API keys, so these totals may be incomplete.")}</p>
                <Table
                  label={tr("Usage by API key table")}
                  head={[tr("Key"), tr("Requests"), tr("Tokens"), tr("Cost")]}
                  rows={a.byApiKey.map((k) => [k.apiKeyName, int(k.requests), num(k.totalTokens), usd(k.cost)])}
                />
              </section>
              <section className="card" style={{ padding: 0, overflow: "hidden" }}>
                <div className="section-head" style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
                  <h2 style={{ margin: 0 }}>{tr("Errors by status")}</h2>
                </div>
                <Table label={tr("Errors by status table")} head={[tr("Type"), tr("Count")]} rows={a.errorBreakdown.map((e) => [e.errorType, int(e.count)])} />
              </section>
            </div>
          </div>

          <section className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div className="section-head" style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
              <div>
                <h2 style={{ margin: 0 }}>{tr("Monthly report")}</h2>
                <small className="muted">{tr("Built from daily totals in the selected range; choose 365d for a full year.")}</small>
              </div>
              <button
                type="button"
                className="btn-ghost"
                onClick={() =>
                  downloadCsv(
                    `usage-monthly-${range}-${csvScope}.csv`,
                    ["month", "requests", "tokens", "est_cost_usd"],
                    months.map(([m, v]) => [m, v.requests, v.tokens, v.cost]),
                  )
                }
              >
                <Download size={13} />
                <span>CSV</span>
              </button>
            </div>
            <Table label={tr("Monthly report table")} head={[tr("Month"), tr("Requests"), tr("Tokens"), tr("Est. cost")]} rows={months.map(([m, v]) => [m, int(v.requests), num(v.tokens), usd(v.cost)])} />
          </section>
        </>
      )}
    </div>
  );
}

const DATE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

function Table({ label, head, rows }: { label: string; head: string[]; rows: string[][] }) {
  if (rows.length === 0) return <p className="muted" style={{ padding: "14px 16px", margin: 0 }}>{DASH}</p>;
  return (
    <TableScroll label={label} stickyPrimary compact={head.length <= 2}><table className="table">
      <thead>
        <tr>{head.map((h) => <th key={h}>{h}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>{r.map((c, j) => <td key={j} className={DATE.test(c) ? "nowrap" : undefined}>{c}</td>)}</tr>
        ))}
      </tbody>
    </table></TableScroll>
  );
}

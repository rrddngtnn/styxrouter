import { useMemo, useState } from "react";
import { BarChart, Stat } from "../lib/charts.tsx";
import { DASH, downloadCsv, int, ms, num, pctText, providerLabel, usd, when } from "../lib/format.ts";
import type { Analytics, Day } from "../lib/types.ts";
import { useFetch } from "../lib/useFetch.ts";


const RANGES = ["1d", "7d", "30d", "90d", "365d", "all"] as const;
type Range = (typeof RANGES)[number];
type Metric = "requests" | "totalTokens" | "cost";

export function Usage() {
  const [range, setRange] = useState<Range>("30d");
  const [metric, setMetric] = useState<Metric>("requests");
  const state = useFetch<Analytics>(`/api/usage/analytics?range=${range}`);
  const a = state.status === "ok" ? state.data : null;
  const provs = useFetch<{ providers?: { id: string; name?: string }[] }>("/api/providers");
  const names = new Map((provs.status === "ok" ? provs.data.providers ?? [] : []).map((p) => [p.id, p.name ?? p.id]));
  const label = (id: string) => providerLabel(id, names);

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
      <h1>Usage</h1>
      <div className="toolbar">
        <div className="seg" role="group" aria-label="Range">
          {RANGES.map((r) => (
            <button key={r} type="button" className={r === range ? "seg-on" : ""} onClick={() => setRange(r)}>{r}</button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Metric">
          {(["requests", "totalTokens", "cost"] as const).map((m) => (
            <button key={m} type="button" className={m === metric ? "seg-on" : ""} onClick={() => setMetric(m)}>
              {m === "totalTokens" ? "tokens" : m}
            </button>
          ))}
        </div>
      </div>
      {state.status === "loading" && <p>Loading...</p>}
      {state.status === "error" && <p className="bad">{state.error.message}</p>}
      {a && (
        <>
          <div className="cards">
            <Stat label="Requests" value={int(a.summary.totalRequests)} sub={`${pctText(a.summary.successRatePct)} succeeded`} />
            <Stat label="Input tokens" value={num(a.summary.promptTokens)} />
            <Stat label="Output tokens" value={num(a.summary.completionTokens)} />
            <Stat label="Avg latency" value={ms(a.summary.avgLatencyMs)} />
            <Stat label="Est. cost" value={usd(a.summary.totalCost)} sub="indicative only" />
          </div>

          <section className="panel-section">
            <h2>Per day</h2>
            <BarChart data={a.dailyTrend.map((d) => ({ label: d.date.slice(5), value: series(d) }))} format={fmt} />
          </section>

          <section className="panel-section">
            <div className="section-head">
              <h2>By provider</h2>
              <button type="button" className="btn-ghost" onClick={() => downloadCsv(`usage-by-provider-${range}.csv`, ["provider", "requests", "tokens", "avg_latency_ms", "success_pct", "est_cost_usd"], a.byProvider.map((p) => [label(p.provider), p.requests, p.totalTokens, p.avgLatencyMs, p.successRatePct, p.cost]))}>CSV</button>
            </div>
            <Table head={["Provider", "Requests", "Tokens", "Latency", "Success", "Cost"]} rows={a.byProvider.map((p) => [label(p.provider), int(p.requests), num(p.totalTokens), ms(p.avgLatencyMs), pctText(p.successRatePct), usd(p.cost)])} />
          </section>

          <section className="panel-section">
            <div className="section-head">
              <h2>By model</h2>
              <button type="button" className="btn-ghost" onClick={() => downloadCsv(`usage-by-model-${range}.csv`, ["model", "provider", "requests", "tokens", "avg_latency_ms", "success_pct", "est_cost_usd"], a.byModel.map((m) => [m.model, label(m.provider), m.requests, m.totalTokens, m.avgLatencyMs, m.successRatePct, m.cost]))}>CSV</button>
            </div>
            <Table head={["Model", "Provider", "Requests", "Tokens", "Latency", "Success", "Cost"]} rows={a.byModel.map((m) => [m.model, label(m.provider), int(m.requests), num(m.totalTokens), ms(m.avgLatencyMs), pctText(m.successRatePct), usd(m.cost)])} />
          </section>

          <div className="two-col">
            <section className="panel-section">
              <h2>By account</h2>
              <Table head={["Account", "Requests", "Tokens", "Last used"]} rows={a.byAccount.slice(0, 15).map((x) => [x.account, int(x.requests), num(x.totalTokens), when(x.lastUsed)])} />
              {a.byAccount.length > 15 && <p className="muted">Top 15 of {a.byAccount.length}.</p>}
            </section>
            <section className="panel-section">
              <h2>By API key</h2>
              <Table head={["Key", "Requests", "Tokens", "Cost"]} rows={a.byApiKey.map((k) => [k.apiKeyName, int(k.requests), num(k.totalTokens), usd(k.cost)])} />
              <h2>Errors</h2>
              <Table head={["Type", "Count"]} rows={a.errorBreakdown.map((e) => [e.errorType, int(e.count)])} />
            </section>
          </div>

          <section className="panel-section">
            <div className="section-head">
              <h2>Monthly report</h2>
              <button type="button" className="btn-ghost" onClick={() => downloadCsv("usage-monthly.csv", ["month", "requests", "tokens", "est_cost_usd"], months.map(([m, v]) => [m, v.requests, v.tokens, v.cost]))}>CSV</button>
            </div>
            <p className="muted">Built from the daily totals in the selected range; pick 365d for a full year.</p>
            <Table head={["Month", "Requests", "Tokens", "Est. cost"]} rows={months.map(([m, v]) => [m, int(v.requests), num(v.tokens), usd(v.cost)])} />
          </section>
        </>
      )}
    </div>
  );
}

const DATE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  if (rows.length === 0) return <p className="muted">{DASH}</p>;
  return (
    <table className="table">
      <thead>
        <tr>{head.map((h) => <th key={h}>{h}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>{r.map((c, j) => <td key={j} className={DATE.test(c) ? "nowrap" : undefined}>{c}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}

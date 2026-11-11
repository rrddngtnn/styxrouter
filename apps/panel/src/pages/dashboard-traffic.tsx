import { useTranslator } from "../lib/useTranslator.ts";
import { useState } from "react";
import { int, num, usd } from "../lib/format.ts";
import type { Day } from "../lib/types.ts";

export type ChartMetric = "requests" | "totalTokens" | "cost";

export function TrafficGraph({ days, metric = "requests" }: { days: Day[]; metric?: ChartMetric }) {
  const tr = useTranslator();
  const [hovered, setHovered] = useState<number | null>(null);
  if (!days.length) return <div className="dashboard-chart-empty">{tr("No traffic recorded in this range.")}</div>;
  const width = 800, height = 220, top = 15, bottom = 195;
  const valueOf = (d: Day) => (metric === "totalTokens" ? d.totalTokens : metric === "cost" ? d.cost : d.requests);
  const formatTick = (v: number) =>
    metric === "totalTokens" ? num(Math.round(v)) : metric === "cost" ? usd(v) : int(Math.round(v));
  const max = Math.max(metric === "cost" ? 0.0001 : 1, ...days.map(valueOf));
  const x = (i: number) => 16 + (days.length === 1 ? 384 : i / (days.length - 1) * 768);
  const y = (value: number) => bottom - value / max * (bottom - top);
  const points = days.map((d, i) => `${x(i)},${y(valueOf(d))}`).join(" ");
  const selected = hovered === null ? null : days[hovered];
  return <div className="dashboard-chart">
    <div className="dashboard-chart-readout" aria-live="polite">
      {selected ? <><strong>{selected.date}</strong><span>{int(selected.requests)} requests</span><span>{int(selected.totalTokens)} tokens</span><span>{usd(selected.cost)} est.</span></> : <span className="muted">{tr("Hover or focus a day for request, token and cost details")}</span>}
    </div>
    <svg viewBox={`0 0 ${width} ${height}`} role="group" aria-label={tr("Daily request traffic")}>
      {[0, 0.5, 1].map(f => <g key={f}><line x1="16" x2="784" y1={y(max * f)} y2={y(max * f)} className="dashboard-gridline" /><text x="18" y={y(max * f) - 5}>{formatTick(max * f)}</text></g>)}
      <polygon points={`16,${bottom} ${points} 784,${bottom}`} className="dashboard-chart-fill" />
      <polyline points={points} className="dashboard-chart-line" />
      {days.map((day, i) => <g key={day.date}>
        <circle cx={x(i)} cy={y(valueOf(day))} r={hovered === i ? 5 : 2.5} className="dashboard-chart-point" />
        <rect x={days.length === 1 ? 0 : x(i) - 384 / (days.length - 1)} y="0" width={days.length === 1 ? width : 768 / (days.length - 1)} height={height} fill="transparent" tabIndex={0} role="img" aria-label={tr("{0}: {1} requests, {2} tokens, {3} estimated cost", {0: String(day.date),1: String(int(day.requests)),2: String(int(day.totalTokens)),3: String(usd(day.cost))})} onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(i)} onBlur={() => setHovered(null)}>
          <title>{day.date}: {int(day.requests)} requests · {int(day.totalTokens)} tokens · {usd(day.cost)} est.</title>
        </rect>
      </g>)}
    </svg>
    <details className="chart-data-alternative"><summary>{tr("View chart data")}</summary><table className="table"><caption>{tr("Daily totals · UTC")}</caption><thead><tr><th>{tr("Date")}</th><th>{tr("Requests")}</th><th>{tr("Tokens")}</th><th>{tr("Cost")}</th></tr></thead><tbody>{days.map(day=><tr key={day.date}><th scope="row">{day.date}</th><td>{int(day.requests)}</td><td>{int(day.totalTokens)}</td><td>{usd(day.cost)}</td></tr>)}</tbody></table></details>
    <div className="dashboard-chart-dates"><span>{days[0]!.date}</span><span>{tr("Daily totals · UTC")}</span><span>{days[days.length - 1]!.date}</span></div>
  </div>;
}

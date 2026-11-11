import { useState, type ReactNode } from "react";
import { usePreferences } from "./preferences.tsx";

export interface Bar {
  label: string;
  value: number;
  title?: string;
}

/** Plain SVG bar chart: no dependency, scales to its container, labels thinned when there are many bars. */
export function BarChart({ data, format = (n: number) => String(n), height = 140, interactive = false }: { data: Bar[]; format?: (n: number) => string; height?: number; interactive?: boolean }): ReactNode {
  const [active, setActive] = useState<number | null>(null);
  const { t } = usePreferences();
  if (data.length === 0) return <p className="muted">{t("No data in this range.")}</p>;
  const max = Math.max(...data.map((d) => d.value), 1);
  if (!interactive && data.every((d) => d.value === 0)) return <p className="muted">{t("Nothing to chart: every value in this range is 0.")}</p>;
  const w = 600;
  const pad = 22;
  // A bar never gets wider than 48 units, so a range with two days of data does not draw two giant blocks.
  const bw = Math.min(w / data.length, 48);
  const x0 = (w - bw * data.length) / 2;
  const every = Math.ceil(data.length / 8);
  return (
    <>
    <svg className="chart" viewBox={`0 0 ${w} ${height + pad}`} role={interactive ? "group" : "img"} aria-label="bar chart">
      {data.map((d, i) => {
        const h = Math.max(d.value > 0 ? 2 : 0, (d.value / max) * height);
        return (
          <g key={`${d.label}-${i}`}>
            <rect x={x0 + i * bw + bw * 0.12} y={height - h} width={bw * 0.76} height={h} rx={2} className="bar">
              <title>{d.title ?? `${d.label}: ${format(d.value)}`}</title>
            </rect>
            {interactive && <rect x={x0 + i * bw} y={0} width={bw} height={height} fill="transparent" tabIndex={0} role="img" aria-label={d.title ?? `${d.label}: ${format(d.value)}`} onFocus={() => setActive(i)} onBlur={() => setActive(null)} onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)} />}
            {i % every === 0 && (
              <text x={x0 + i * bw + bw / 2} y={height + 15} textAnchor="middle" className="chart-label">
                {d.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
    <details className="chart-data-alternative"><summary>{t("View chart data")}</summary><table className="table"><caption>{t("Chart values")}</caption><thead><tr><th>{t("Label")}</th><th>{t("Value")}</th></tr></thead><tbody>{data.map((row,index)=><tr key={`${row.label}-${index}`}><th scope="row">{row.label}</th><td>{format(row.value)}</td></tr>)}</tbody></table></details>
    {interactive && <p aria-live="polite" style={{ minHeight: "1.5em", margin: 0 }}>{active !== null && data[active] ? (data[active].title ?? `${data[active].label}: ${format(data[active].value)}`) : ""}</p>}
    </>
  );
}

/** Horizontal meter, `value` 0-100. */
export function Meter({ value, tone }: { value: number; tone?: "ok" | "warn" | "bad" }) {
  const v = Math.max(0, Math.min(100, value));
  const t = tone ?? (v < 15 ? "bad" : v < 40 ? "warn" : "ok");
  return (
    <div className="meter" role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`meter-fill ${t}`} style={{ width: `${v}%` }} />
    </div>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "ok" | "bad" }) {
  return (
    <div className="card">
      <h3>{label}</h3>
      <p className={tone}>{value}</p>
      {sub ? <small className="muted">{sub}</small> : null}
    </div>
  );
}

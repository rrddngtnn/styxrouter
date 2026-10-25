export const DASH = "\u2014";

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const plain = new Intl.NumberFormat("en");

export const num = (n?: number | null) => (n == null || Number.isNaN(n) ? DASH : compact.format(n));
export const int = (n?: number | null) => (n == null || Number.isNaN(n) ? DASH : plain.format(n));
export const pctText = (n?: number | string | null) => {
  const v = typeof n === "string" ? Number(n) : n;
  return v == null || Number.isNaN(v) ? DASH : `${v.toFixed(1)}%`;
};
/** Estimated cost: the router does not bill anyone; prices come from a public table and are indicative only. */
export const usd = (n?: number | null) => {
  if (n == null || Number.isNaN(n)) return DASH;
  if (n === 0) return "$0";
  return n < 1 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
};
export const ms = (n?: number | null) => (n == null ? DASH : n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${Math.round(n)}ms`);

export function ago(iso?: string | null, now = Date.now()): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** "2h 14m", "5d 3h", "now" when the moment has passed. */
export function countdown(iso?: string | null, now = Date.now()): string {
  if (!iso) return DASH;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return DASH;
  const s = Math.round((t - now) / 1000);
  if (s <= 0) return "now";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export const when = (iso?: string | null) => (iso ? iso.slice(0, 19).replace("T", " ") : DASH);

/** Download rows as a CSV file (values quoted; formulas neutralised so a spreadsheet will not execute them). */
export function downloadCsv(filename: string, header: string[], rows: (string | number | null | undefined)[][]) {
  const cell = (v: string | number | null | undefined) => {
    let s = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const csv = [header, ...rows].map((r) => r.map(cell).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Registry name when known; the generated id of a user-added endpoint becomes "Custom endpoint". */
export const providerLabel = (id: string, names?: Map<string, string>) =>
  names?.get(id) ?? id.replace(/^openai-compatible-[a-z]+-[0-9a-f-]{20,}$/, "Custom endpoint");

/** A reset time already in the past means the window has rolled over, not that it resets "now". */
export const resetText = (iso: string | null | undefined, now = Date.now()) =>
  !iso ? DASH : Date.parse(iso) <= now ? "already reset" : countdown(iso, now);

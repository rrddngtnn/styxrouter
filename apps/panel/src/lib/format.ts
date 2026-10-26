export const DASH = "\u2014";

const currentLocale = () => typeof document !== 'undefined' && document.documentElement.lang === 'id' ? 'id-ID' : 'en-US';
const formatters = new Map<string, Intl.NumberFormat>();
function formatter(locale: string, compact = false) {
  const key = `${locale}:${compact}`;
  if (!formatters.has(key)) formatters.set(key, new Intl.NumberFormat(locale, compact ? { notation: 'compact', maximumFractionDigits: 1 } : {}));
  return formatters.get(key)!;
}
export const num = (n?: number | null, locale = currentLocale()) => (n == null || !Number.isFinite(n) ? DASH : formatter(locale, true).format(n));
export const int = (n?: number | null, locale = currentLocale()) => (n == null || !Number.isFinite(n) ? DASH : formatter(locale).format(n));
export const pctText = (n?: number | string | null) => {
  const v = typeof n === "string" ? Number(n) : n;
  return v == null || Number.isNaN(v) ? DASH : `${new Intl.NumberFormat(currentLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(v)}%`;
};
/** Estimated cost: the router does not bill anyone; prices come from a public table and are indicative only. */
export const usd = (n?: number | null, locale = currentLocale()) => {
  if (n == null || Number.isNaN(n)) return DASH;
  if (n === 0) return "$0";
  return new Intl.NumberFormat(locale, { style: "currency", currency: "USD", minimumFractionDigits: n < 1 ? 4 : 2, maximumFractionDigits: n < 1 ? 4 : 2 }).format(n);
};
export const ms = (n?: number | null) => (n == null ? DASH : n >= 1000 ? `${new Intl.NumberFormat(currentLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n / 1000)}s` : `${Math.round(n)}ms`);

export function ago(iso?: string | null, now = Date.now()): string {
  const isId = typeof document !== "undefined" && document.documentElement.lang === "id";
  if (!iso) return isId ? "belum pernah" : "never";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return isId ? `${s} dtk lalu` : `${s}s ago`;
  if (s < 3600) return isId ? `${Math.floor(s / 60)} mnt lalu` : `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return isId ? `${Math.floor(s / 3600)} jam lalu` : `${Math.floor(s / 3600)}h ago`;
  return isId ? `${Math.floor(s / 86400)} hr lalu` : `${Math.floor(s / 86400)}d ago`;
}

/** "2h 14m", "5d 3h", "now" when the moment has passed. */
export function countdown(iso?: string | null, now = Date.now()): string {
  const isId = typeof document !== "undefined" && document.documentElement.lang === "id";
  if (!iso) return DASH;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return DASH;
  const s = Math.round((t - now) / 1000);
  if (s <= 0) return isId ? "sekarang" : "now";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return isId ? `${d}h ${h}j` : `${d}d ${h}h`;
  if (h > 0) return isId ? `${h}j ${m}m` : `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export const when = (iso?: string | null, locale = currentLocale()) => {
  if (!iso) return DASH;
  const date = new Date(/Z$|[+-]\d{2}:\d{2}$/.test(iso) ? iso : iso.replace(' ', 'T') + 'Z');
  if (!Number.isFinite(date.getTime())) return DASH;
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC', hour12: false }).format(date);
};

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
export const resetText = (iso: string | null | undefined, now = Date.now()) => {
  const isId = typeof document !== "undefined" && document.documentElement.lang === "id";
  return !iso ? DASH : Date.parse(iso) <= now ? (isId ? "sudah di-reset" : "already reset") : countdown(iso, now);
};

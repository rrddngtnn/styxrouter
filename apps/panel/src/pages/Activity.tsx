import { useMemo, useState } from "react";
import { DASH, int, ms, when } from "../lib/format.ts";
import { useFetch } from "../lib/useFetch.ts";

interface CallLog {
  id: string;
  timestamp: string;
  method?: string;
  path?: string;
  status?: number;
  model?: string;
  provider?: string;
  providerDisplay?: string;
  account?: string;
  duration?: number;
  tokens?: { in?: number | null; out?: number | null };
  apiKeyName?: string;
  comboName?: string | null;
  error?: string | null;
}

export function Activity() {
  const [limit, setLimit] = useState(100);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [q, setQ] = useState("");
  const state = useFetch<CallLog[]>(`/api/usage/call-logs?limit=${limit}`);
  const rows = useMemo(() => {
    const all = state.status === "ok" && Array.isArray(state.data) ? state.data : [];
    const needle = q.trim().toLowerCase();
    return all.filter((r) => {
      if (onlyErrors && !(r.status && r.status >= 400)) return false;
      if (!needle) return true;
      return [r.model, r.providerDisplay, r.provider, r.account, r.apiKeyName, r.path].some((v) => v?.toLowerCase().includes(needle));
    });
  }, [state, onlyErrors, q]);

  return (
    <div className="page">
      <h1>Activity</h1>
      <p className="muted">Recent requests (metadata only; bodies are not shown).</p>
      <div className="toolbar">
        <input type="search" placeholder="Filter by model, provider, account or key" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="check"><input type="checkbox" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} /> errors only</label>
        <select value={limit} onChange={(e) => setLimit(Number(e.target.value))} aria-label="Rows">
          {[50, 100, 250, 500].map((n) => <option key={n} value={n}>{n} rows</option>)}
        </select>
        <button type="button" className="btn-ghost" onClick={state.reload}>Refresh</button>
      </div>
      {state.status === "loading" && <p>Loading...</p>}
      {state.status === "error" && <p className="bad">{state.error.message}</p>}
      {state.status === "ok" && rows.length === 0 && <p className="muted">Nothing matches.</p>}
      {rows.length > 0 && (
        <table className="table">
          <thead>
            <tr><th>Time</th><th>Key</th><th>Provider</th><th>Account</th><th>Model</th><th>Status</th><th>Time taken</th><th>Tokens in/out</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r.status && r.status >= 400 ? "row-bad" : ""}>
                <td className="nowrap">{when(r.timestamp)}</td>
                <td>{r.apiKeyName ?? DASH}</td>
                <td>{r.providerDisplay ?? r.provider ?? DASH}</td>
                <td>{r.account ?? DASH}</td>
                <td><code>{r.model ?? DASH}</code>{r.comboName ? <span className="muted"> via {r.comboName}</span> : null}</td>
                <td className={r.status && r.status >= 400 ? "bad" : "ok"}>{r.status ?? DASH}</td>
                <td>{ms(r.duration)}</td>
                <td>{r.tokens ? `${int(r.tokens.in)} / ${int(r.tokens.out)}` : DASH}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

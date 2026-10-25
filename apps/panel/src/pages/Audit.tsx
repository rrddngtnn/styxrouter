import { useState } from "react";
import { DASH, when } from "../lib/format.ts";
import { useFetch } from "../lib/useFetch.ts";

interface Entry {
  id: number;
  timestamp: string;
  action: string;
  actor: string;
  target: string | null;
  details: unknown;
  status: string | null;
}

/** Admin action history (keys, combos, accounts, settings writes) from the audit log. */
export function Audit() {
  const state = useFetch<{ entries?: Entry[]; total?: number }>("/api/audit-log?limit=200");
  const [filter, setFilter] = useState("");
  const entries = state.status === "ok" ? state.data.entries ?? [] : [];
  const shown = filter.trim()
    ? entries.filter((e) => `${e.action} ${e.target ?? ""} ${e.actor}`.toLowerCase().includes(filter.trim().toLowerCase()))
    : entries;

  return (
    <div className="page">
      <h1>Audit log</h1>
      <p className="muted">Every admin write the router recorded — key and combo changes, account actions, settings updates.</p>
      <div className="toolbar">
        <input type="search" placeholder="Filter by action, target or actor…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button type="button" className="btn-ghost" onClick={state.reload}>Reload</button>
      </div>
      {state.status === "loading" && <p>Loading…</p>}
      {state.status === "error" && <p className="bad">{state.error.message}</p>}
      {state.status === "ok" && shown.length === 0 && <p className="muted">No entries{filter ? " match the filter" : " yet"}.</p>}
      <table className="table fixed">
        <colgroup><col style={{ width: "16%" }} /><col style={{ width: "20%" }} /><col style={{ width: "10%" }} /><col style={{ width: "22%" }} /><col /></colgroup>
        <thead><tr><th>When</th><th>Action</th><th>Actor</th><th>Target</th><th>Details</th></tr></thead>
        <tbody>
          {shown.map((e) => (
            <tr key={e.id}>
              <td title={e.timestamp}>{when(e.timestamp)}</td>
              <td><code>{e.action}</code></td>
              <td>{e.actor}</td>
              <td className="ellip" title={e.target ?? undefined}>{e.target ?? DASH}</td>
              <td className="ellip"><code>{summarize(e.details)}</code></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function summarize(details: unknown): string {
  if (details == null) return "";
  if (typeof details === "string") return details;
  try {
    return JSON.stringify(details).slice(0, 120);
  } catch {
    return "";
  }
}

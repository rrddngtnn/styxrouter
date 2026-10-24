import { useFetch } from "../lib/useFetch.ts";

interface Entry {
  id?: string;
  ts?: string;
  method?: string;
  path?: string;
  provider?: string;
  model?: string;
  status?: number;
  latencyMs?: number;
  errorCode?: string | null;
}

export function Activity() {
  const state = useFetch<{ entries?: Entry[] }>("/api/activity?limit=50");
  const rows = state.status === "ok" ? state.data.entries ?? [] : [];

  return (
    <div className="page">
      <h1>Activity</h1>
      <p className="muted">
        Recent requests (metadata only — bodies redacted).
      </p>
      {state.status === "loading" && <p>Loading…</p>}
      {state.status === "error" && <p className="bad">{state.error.message}</p>}
      {state.status === "ok" && rows.length === 0 && (
        <p className="muted">No activity recorded.</p>
      )}
      {state.status === "ok" && rows.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Method</th>
              <th>Path</th>
              <th>Provider</th>
              <th>Model</th>
              <th>Status</th>
              <th>Latency</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={String(r.id ?? i)} className={r.status && r.status >= 400 ? "row-bad" : ""}>
                <td>{r.ts?.slice(0, 19).replace("T", " ") ?? "—"}</td>
                <td>{r.method ?? "—"}</td>
                <td><code>{r.path ?? "—"}</code></td>
                <td>{r.provider ?? "—"}</td>
                <td>{r.model ?? "—"}</td>
                <td>{r.status ?? "—"}</td>
                <td>{r.latencyMs != null ? `${r.latencyMs}ms` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

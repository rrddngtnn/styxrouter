import { useFetch } from "../lib/useFetch.ts";

interface ComboRow {
  id?: string | number;
  name?: string;
  provider?: string;
  model?: string;
  strategy?: string;
  enabled?: boolean | number;
}

export function Routing() {
  const state = useFetch<{ combos?: ComboRow[] }>("/api/routing/combos");
  const rows = state.status === "ok" ? state.data.combos ?? [] : [];

  return (
    <div className="page">
      <h1>Routing</h1>
      <p className="muted">
        Combo/alias/fallback routes resolved from the active storage DB.
      </p>
      {state.status === "loading" && <p>Loading…</p>}
      {state.status === "error" && <p className="bad">{state.error.message}</p>}
      {state.status === "ok" && rows.length === 0 && (
        <p className="muted">No combos configured.</p>
      )}
      {state.status === "ok" && rows.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Strategy</th>
              <th>Provider</th>
              <th>Model</th>
              <th>Enabled</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={String(r.id ?? i)}>
                <td>{r.name ?? "—"}</td>
                <td>{r.strategy ?? "—"}</td>
                <td>{r.provider ?? "—"}</td>
                <td>{r.model ?? "—"}</td>
                <td>{r.enabled ? "yes" : "no"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

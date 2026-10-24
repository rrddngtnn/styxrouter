import { useFetch } from "../lib/useFetch.ts";

interface KeyRow {
  id?: string | number;
  name?: string;
  prefix?: string;
  createdAt?: string;
  lastUsedAt?: string | null;
  modelRestrictions?: string[] | null;
}

export function Keys() {
  const state = useFetch<{ keys?: KeyRow[] }>("/api/keys");
  const rows = state.status === "ok" ? state.data.keys ?? [] : [];

  return (
    <div className="page">
      <h1>API Keys</h1>
      <p className="muted">Inference-plane API keys (secret bytes write-only).</p>
      {state.status === "loading" && <p>Loading…</p>}
      {state.status === "error" && <p className="bad">{state.error.message}</p>}
      {state.status === "ok" && rows.length === 0 && (
        <p className="muted">No API keys issued.</p>
      )}
      {state.status === "ok" && rows.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Prefix</th>
              <th>Created</th>
              <th>Last used</th>
              <th>Model restriction</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={String(r.id ?? i)}>
                <td>{r.name ?? "—"}</td>
                <td><code>{r.prefix ?? "—"}</code></td>
                <td>{r.createdAt?.slice(0, 10) ?? "—"}</td>
                <td>{r.lastUsedAt?.slice(0, 10) ?? "never"}</td>
                <td>{r.modelRestrictions?.join(", ") || "unrestricted"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

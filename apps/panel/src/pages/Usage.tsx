import { useFetch } from "../lib/useFetch.ts";

interface UsageAnalytics {
  totals?: {
    requests?: number;
    input_tokens?: number;
    output_tokens?: number;
    cost_usd?: number;
  };
}

export function Usage() {
  const state = useFetch<UsageAnalytics>("/api/usage/analytics");

  return (
    <div className="page">
      <h1>Usage</h1>
      {state.status === "loading" && <p>Loading…</p>}
      {state.status === "error" && <p className="bad">{state.error.message}</p>}
      {state.status === "ok" && (
        <div className="cards">
          <Card label="Requests" value={state.data.totals?.requests} />
          <Card label="Input tokens" value={state.data.totals?.input_tokens} />
          <Card label="Output tokens" value={state.data.totals?.output_tokens} />
          <Card
            label="Cost (USD)"
            value={state.data.totals?.cost_usd?.toFixed(4) ?? "—"}
          />
        </div>
      )}
    </div>
  );
}

function Card({ label, value }: { label: string; value: number | string | undefined }) {
  return (
    <div className="card">
      <h3>{label}</h3>
      <p>{value ?? "—"}</p>
    </div>
  );
}

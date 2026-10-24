import { useFetch } from "../lib/useFetch.ts";

interface HealthPing {
  ok: boolean;
  uptime_seconds?: number;
  version?: string;
}

interface ProviderCount {
  total?: number;
}

export function Dashboard() {
  const health = useFetch<HealthPing>("/api/health/ping");
  const providers = useFetch<ProviderCount & { providers?: unknown[] }>("/api/providers");

  return (
    <div className="page">
      <h1>Overview</h1>
      <div className="cards">
        <div className="card">
          <h3>Health</h3>
          {health.status === "loading" && <p>…</p>}
          {health.status === "ok" && (
            <>
              <p className={health.data.ok ? "ok" : "bad"}>{health.data.ok ? "OK" : "DOWN"}</p>
              {health.data.version && <small>v{health.data.version}</small>}
            </>
          )}
          {health.status === "error" && <p className="bad">unreachable</p>}
        </div>
        <div className="card">
          <h3>Providers</h3>
          {providers.status === "loading" && <p>…</p>}
          {providers.status === "ok" && (
            <p>{providers.data.providers?.length ?? providers.data.total ?? "–"}</p>
          )}
          {providers.status === "error" && <p className="bad">error</p>}
        </div>
      </div>
    </div>
  );
}

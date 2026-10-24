import { useMemo, useState } from "react";
import { useFetch } from "../lib/useFetch.ts";

interface Provider {
  id: string;
  name?: string;
  enabled?: boolean;
  healthy?: boolean;
  authType?: "oauth" | "apikey" | "none" | string;
  authModes?: string[];
  vendor?: string;
}

interface ProvidersResponse {
  providers?: Provider[];
}

type Tab = "oauth" | "apikey";

export function Providers() {
  const state = useFetch<ProvidersResponse>("/api/providers");
  const [tab, setTab] = useState<Tab>("oauth");

  const providers = state.status === "ok" ? state.data.providers ?? [] : [];

  const { oauthList, apikeyList, vendorCounts } = useMemo(() => {
    const oauth: Provider[] = [];
    const apikey: Provider[] = [];
    const vendors: Record<string, number> = {};
    for (const p of providers) {
      const modes = p.authModes ?? (p.authType ? [p.authType] : []);
      if (modes.includes("oauth")) oauth.push(p);
      if (modes.includes("apikey")) apikey.push(p);
      if (p.vendor) vendors[p.vendor] = (vendors[p.vendor] ?? 0) + 1;
    }
    return {
      oauthList: oauth.sort(cmp),
      apikeyList: apikey.sort(cmp),
      vendorCounts: vendors,
    };
  }, [providers]);

  const list = tab === "oauth" ? oauthList : apikeyList;

  return (
    <div className="page">
      <h1>Providers</h1>

      {state.status === "loading" && <p>Loading…</p>}
      {state.status === "error" && <p className="bad">{state.error.message}</p>}

      {state.status === "ok" && (
        <>
          <div className="tabs" role="tablist">
            <button
              role="tab"
              aria-selected={tab === "oauth"}
              className={tab === "oauth" ? "tab active" : "tab"}
              onClick={() => setTab("oauth")}
            >
              OAuth Logins
              <span className="tab-count">{oauthList.length}</span>
            </button>
            <button
              role="tab"
              aria-selected={tab === "apikey"}
              className={tab === "apikey" ? "tab active" : "tab"}
              onClick={() => setTab("apikey")}
            >
              API Keys
              <span className="tab-count">{apikeyList.length}</span>
            </button>
          </div>

          <div className="provider-grid">
            {list.map((p) => (
              <ProviderCard key={p.id + "-" + tab} provider={p} tab={tab} />
            ))}
            {list.length === 0 && <p className="muted">No providers in this bucket.</p>}
          </div>

          {Object.keys(vendorCounts).length > 0 && (
            <section className="vendor-summary">
              <h3>Grouped by vendor</h3>
              <ul className="vendor-list">
                {Object.entries(vendorCounts)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([vendor, count]) => (
                    <li key={vendor}>
                      <span className="vendor-badge">{vendor}</span>
                      <span className="vendor-count">{count}</span>
                    </li>
                  ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

interface CardProps {
  provider: Provider;
  tab: Tab;
}

function ProviderCard({ provider, tab }: CardProps) {
  const name = provider.name ?? provider.id;
  const vendor = provider.vendor ?? "—";
  const status = provider.healthy ? "ok" : provider.enabled === false ? "disabled" : "down";
  const action = tab === "oauth" ? "Start Flow" : "Add Key";
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function startOauth() {
    setBusy(true);
    setMsg(null);
    try {
      const init = await fetch(`/api/oauth/${provider.id}/init`, { method: "POST" });
      if (!init.ok) throw new Error(`init failed: ${init.status}`);
      const { authUrl, state, userCode } = await init.json();
      if (!authUrl || !state) throw new Error("no authUrl/state returned");
      window.open(authUrl, "_blank", "noopener");
      setMsg(userCode ? `code: ${userCode} — polling…` : "polling…");
      // poll every 5s, max 10 min
      const deadline = Date.now() + 10 * 60 * 1000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 5000));
        const r = await fetch(
          `/api/oauth/${provider.id}/poll?state=${encodeURIComponent(state)}`,
        );
        const body = await r.json().catch(() => ({}));
        if (body?.ok) {
          setMsg("linked ✓");
          return;
        }
        if (body?.error) throw new Error(body.error);
      }
      throw new Error("timed out");
    } catch (e: any) {
      setMsg(`err: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={`provider-card status-${status}`}>
      <header>
        <code className="provider-id">{provider.id}</code>
        <span className="vendor-badge">{vendor}</span>
      </header>
      <div className="provider-body">
        <div className="provider-name">{name}</div>
        <div className="provider-meta">
          <span className={`health ${status}`}>{status}</span>
          <span className="auth-type">{provider.authType ?? "—"}</span>
        </div>
        {msg && <div className="muted" style={{ marginTop: 8 }}>{msg}</div>}
      </div>
      <footer>
        <button
          type="button"
          className="btn-add"
          disabled={busy || tab !== "oauth"}
          onClick={tab === "oauth" ? startOauth : undefined}
          title={tab === "apikey" ? "add via API-key input (todo)" : ""}
        >
          {busy ? "…" : action}
        </button>
      </footer>
    </article>
  );
}

function cmp(a: Provider, b: Provider): number {
  const av = a.vendor ?? "zzz";
  const bv = b.vendor ?? "zzz";
  if (av !== bv) return av.localeCompare(bv);
  return a.id.localeCompare(b.id);
}

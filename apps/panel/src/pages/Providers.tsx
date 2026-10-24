import { useMemo, useState } from "react";
import { api } from "../lib/api.ts";
import { useAction } from "../lib/actions.tsx";
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

interface Account {
  id: string;
  provider: string;
  name: string | null;
  authType?: string;
  isActive: boolean;
  testStatus: string | null;
  lastError: string | null;
  backoffLevel: number;
}

type Tab = "oauth" | "apikey";

export function Providers() {
  const state = useFetch<ProvidersResponse>("/api/providers");
  const accountsState = useFetch<{ connections?: Account[] }>("/api/connections");
  const [tab, setTab] = useState<Tab>("oauth");

  const providers = state.status === "ok" ? state.data.providers ?? [] : [];
  const accounts = accountsState.status === "ok" ? accountsState.data.connections ?? [] : [];
  const refresh = () => {
    state.reload();
    accountsState.reload();
  };

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

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const a of accounts) c[a.provider] = (c[a.provider] ?? 0) + 1;
    return c;
  }, [accounts]);

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
              <ProviderCard key={p.id + "-" + tab} provider={p} tab={tab} accounts={counts[p.id] ?? 0} onChanged={refresh} />
            ))}
            {list.length === 0 && <p className="muted">No providers in this bucket.</p>}
          </div>

          <AccountsTable accounts={accounts} providers={providers} loading={accountsState.status === "loading"} error={accountsState.status === "error" ? accountsState.error.message : null} onChanged={refresh} />

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
  accounts: number;
  onChanged: () => void;
}

function ProviderCard({ provider, tab, accounts, onChanged }: CardProps) {
  const name = provider.name ?? provider.id;
  const vendor = provider.vendor ?? "—";
  const status = provider.healthy ? "ok" : provider.enabled === false ? "disabled" : "down";
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const { busy: saving, error, run } = useAction(onChanged);

  async function startOauth() {
    setBusy(true);
    setMsg(null);
    try {
      const init = await fetch(`/api/oauth/${provider.id}/init`, { method: "POST", credentials: "include" });
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
          { credentials: "include" },
        );
        const body = await r.json().catch(() => ({}));
        if (body?.ok) {
          setMsg("linked ✓");
          onChanged();
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

  async function addKey(e: React.FormEvent) {
    e.preventDefault();
    const made = await run("add", () =>
      api.post("/api/connections", { provider: provider.id, name: label.trim() || provider.id, apiKey: apiKey.trim() }),
    );
    if (made) {
      setApiKey("");
      setLabel("");
      setAdding(false);
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
          <span className="muted">{accounts} account{accounts === 1 ? "" : "s"}</span>
        </div>
        {msg && <div className="muted" style={{ marginTop: 8 }}>{msg}</div>}
        {tab === "apikey" && adding && (
          <form className="stack-form" onSubmit={addKey}>
            <input type="text" placeholder="Account label (optional)" value={label} maxLength={200} onChange={(e) => setLabel(e.target.value)} />
            <input type="password" placeholder="API key" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} required minLength={8} />
            {error && <div className="bad">{error}</div>}
            <div className="row-actions">
              <button type="submit" className="btn-add" disabled={saving !== null || apiKey.trim().length < 8}>
                {saving ? "…" : "Save"}
              </button>
              <button type="button" className="btn-ghost" onClick={() => { setAdding(false); setApiKey(""); }}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
      <footer>
        {tab === "oauth" ? (
          <button type="button" className="btn-add" disabled={busy} onClick={startOauth}>
            {busy ? "…" : "Start Flow"}
          </button>
        ) : (
          !adding && (
            <button type="button" className="btn-add" onClick={() => setAdding(true)}>
              Add Key
            </button>
          )
        )}
      </footer>
    </article>
  );
}

function AccountsTable({
  accounts,
  providers,
  loading,
  error,
  onChanged,
}: {
  accounts: Account[];
  providers: Provider[];
  loading: boolean;
  error: string | null;
  onChanged: () => void;
}) {
  const { busy, error: actionError, run } = useAction(onChanged);
  const [results, setResults] = useState<Record<string, string>>({});
  const label = useMemo(() => new Map(providers.map((p) => [p.id, p.name ?? p.id])), [providers]);
  const sorted = useMemo(
    () => [...accounts].sort((a, b) => a.provider.localeCompare(b.provider) || String(a.name).localeCompare(String(b.name))),
    [accounts],
  );

  async function test(id: string) {
    const out = await run(`test-${id}`, () => api.post<{ ok: boolean; error: string | null }>(`/api/connections/${id}/test`));
    if (out) setResults((r) => ({ ...r, [id]: out.ok ? "key works ✓" : `failed: ${out.error ?? "rejected"}` }));
  }

  return (
    <section className="accounts">
      <h2>Connected accounts <span className="tab-count">{accounts.length}</span></h2>
      {loading && <p>Loading…</p>}
      {error && <p className="bad">{error}</p>}
      {actionError && <p className="bad">{actionError}</p>}
      {!loading && !error && accounts.length === 0 && <p className="muted">No accounts connected yet. Use “Add Key” or “Start Flow” above.</p>}
      {accounts.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Provider</th>
              <th>Account</th>
              <th>Status</th>
              <th>Last error</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sorted.map((a) => {
              const failing = a.testStatus !== null && a.testStatus !== "active";
              return (
                <tr key={a.id} className={a.isActive ? "" : "row-off"}>
                  <td>{label.get(a.provider) ?? a.provider}</td>
                  <td>{a.name ?? a.id.slice(0, 8)}</td>
                  <td className={!a.isActive ? "muted" : failing ? "bad" : "ok"}>
                    {!a.isActive ? "disabled" : a.testStatus ?? "unchecked"}
                    {a.backoffLevel > 0 ? ` · backoff ${a.backoffLevel}` : ""}
                  </td>
                  <td className="cell-error" title={a.lastError ?? undefined}>
                    {results[a.id] ?? (a.lastError ? a.lastError.replace(/\s+/g, " ").slice(0, 80) : "")}
                  </td>
                  <td className="row-actions">
                    <button type="button" className="btn-ghost" disabled={busy !== null} onClick={() => test(a.id)}>Test</button>
                    {(failing || a.backoffLevel > 0) && (
                      <button
                        type="button"
                        className="btn-ghost"
                        disabled={busy !== null}
                        onClick={() => run(`cool-${a.id}`, () => api.post(`/api/connections/${a.id}/release-cooldown`))}
                      >
                        Clear error
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={busy !== null}
                      onClick={() => run(`toggle-${a.id}`, () => api.patch(`/api/connections/${a.id}`, { isActive: !a.isActive }))}
                    >
                      {a.isActive ? "Disable" : "Enable"}
                    </button>
                    <button
                      type="button"
                      className="btn-danger"
                      disabled={busy !== null}
                      onClick={() => run(`del-${a.id}`, () => api.delete(`/api/connections/${a.id}`), `Delete account “${a.name ?? a.id.slice(0, 8)}”? Its stored credentials are removed.`)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

function cmp(a: Provider, b: Provider): number {
  const av = a.vendor ?? "zzz";
  const bv = b.vendor ?? "zzz";
  if (av !== bv) return av.localeCompare(bv);
  return a.id.localeCompare(b.id);
}

import { useMemo, useState } from "react";
import { api, type JsonValue } from "../lib/api.ts";
import { useAction } from "../lib/actions.tsx";
import { DASH } from "../lib/format.ts";
import { useFetch } from "../lib/useFetch.ts";
import { OAuthConnect, type FlowType } from "./OAuthConnect.tsx";

interface Provider {
  id: string;
  name?: string;
  enabled?: boolean;
  healthy?: boolean;
  accounts?: number;
  activeAccounts?: number;
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

interface Node {
  id: string;
  type: string;
  name: string;
  prefix: string | null;
  apiType: string | null;
  baseUrl: string | null;
  chatPath: string | null;
  modelsPath: string | null;
  customHeaders: Record<string, string> | null;
  createdAt: string | null;
}

type Tab = "oauth" | "apikey" | "custom";

const API_TYPES = ["chat", "responses", "embeddings", "rerank", "audio-transcriptions", "audio-speech", "images-generations"] as const;
const blankNode = { type: "openai-compatible", name: "", prefix: "", apiType: "chat", baseUrl: "", chatPath: "", modelsPath: "" };

export function Providers() {
  const state = useFetch<ProvidersResponse>("/api/providers");
  const accountsState = useFetch<{ connections?: Account[] }>("/api/connections");
  const nodesState = useFetch<{ nodes?: Node[] }>("/api/provider-nodes");
  const flowsState = useFetch<{ providers?: { id: string; flowType: FlowType; legacyDevice?: boolean; redirectUri?: string }[] }>("/api/oauth/providers");
  const flows = useMemo(() => new Map((flowsState.status === "ok" ? flowsState.data.providers ?? [] : []).map((f) => [f.id, f])), [flowsState]);
  const [tab, setTab] = useState<Tab>("oauth");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [editingNode, setEditingNode] = useState<"new" | null>(null);

  const providers = state.status === "ok" ? state.data.providers ?? [] : [];
  const accounts = accountsState.status === "ok" ? accountsState.data.connections ?? [] : [];
  const nodes = nodesState.status === "ok" ? nodesState.data.nodes ?? [] : [];
  const refresh = () => {
    state.reload();
    accountsState.reload();
    nodesState.reload();
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
    const c: Record<string, { total: number; active: number }> = {};
    for (const a of accounts) {
      const slot = c[a.provider] ?? { total: 0, active: 0 };
      slot.total += 1;
      if (a.isActive && a.testStatus === "active") slot.active += 1;
      c[a.provider] = slot;
    }
    return c;
  }, [accounts]);

  const bulkProviders = useMemo(() => {
    const customAsProviders: Provider[] = nodes.map((n) => ({
      id: n.id,
      name: `${n.name} (${n.prefix ?? "custom"})`,
      authType: "apikey",
      authModes: ["apikey"],
    }));
    return [...apikeyList, ...customAsProviders];
  }, [apikeyList, nodes]);

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
            <button
              role="tab"
              aria-selected={tab === "custom"}
              className={tab === "custom" ? "tab active" : "tab"}
              onClick={() => setTab("custom")}
            >
              Custom Providers
              <span className="tab-count">{nodes.length}</span>
            </button>
          </div>

          {tab !== "custom" ? (
            <div className="provider-grid">
              {list.map((p) => (
                <ProviderCard key={p.id + "-" + tab} provider={p} tab={tab} accounts={counts[p.id]?.total ?? 0} flow={flows.get(p.id)?.flowType} legacyDevice={flows.get(p.id)?.legacyDevice} redirectUri={flows.get(p.id)?.redirectUri} onChanged={refresh} />
              ))}
              {list.length === 0 && <p className="muted">No providers in this bucket.</p>}
            </div>
          ) : (
            <section>
              <p className="muted">
                OpenAI- or Anthropic-compatible endpoints routed through their own prefix (e.g. <code>muse/model</code>).
                Each card holds both the endpoint definition and the API keys attached to it.
              </p>
              <div className="toolbar">
                <button type="button" className="btn-add" onClick={() => setEditingNode("new")}>
                  New custom provider
                </button>
              </div>
              {editingNode === "new" && (
                <section className="editor card" style={{ marginBottom: 16 }}>
                  <h2>New custom provider</h2>
                  <NodeForm
                    onDone={() => {
                      setEditingNode(null);
                      refresh();
                    }}
                  />
                </section>
              )}
              <div className="provider-grid">
                {nodes.map((n) => (
                  <CustomNodeCard
                    key={n.id}
                    node={n}
                    accounts={counts[n.id]?.total ?? 0}
                    activeAccounts={counts[n.id]?.active ?? 0}
                    onChanged={refresh}
                  />
                ))}
                {nodes.length === 0 && editingNode === null && <p className="muted">No custom providers yet.</p>}
              </div>
            </section>
          )}

          <div className="toolbar">
            <button type="button" className="btn-ghost" onClick={() => setBulkOpen((o) => !o)}>
              Bulk add keys
            </button>
          </div>
          {bulkOpen && <BulkAdd providers={bulkProviders} onDone={refresh} />}

          <AccountsTable accounts={accounts} providers={providers} nodes={nodes} loading={accountsState.status === "loading"} error={accountsState.status === "error" ? accountsState.error.message : null} onChanged={refresh} />

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
  flow?: FlowType;
  legacyDevice?: boolean;
  redirectUri?: string;
  onChanged: () => void;
}

function ProviderCard({ provider, tab, accounts, flow, legacyDevice, redirectUri, onChanged }: CardProps) {
  const name = provider.name ?? provider.id;
  const vendor = provider.vendor ?? "—";
  const status = provider.healthy ? "ok" : provider.enabled === false ? "disabled" : "down";
  const [connecting, setConnecting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const { busy: saving, error, run } = useAction(onChanged);

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
          <span className={`health ${status}`}>{status === "disabled" ? "no accounts" : status}</span>
          <span className="auth-type">{provider.authType ?? "—"}</span>
          <span className="muted" title="Accounts whose last check passed, out of all accounts for this provider">{accounts > 0 ? `${provider.activeAccounts ?? 0}/${accounts} active` : "0 accounts"}</span>
        </div>
        {tab === "oauth" && connecting && flow && (
          <OAuthConnect provider={provider.id} flow={flow} legacyDevice={legacyDevice} redirectUri={redirectUri} onDone={onChanged} onClose={() => setConnecting(false)} />
        )}
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
          flow ? (
            !connecting && (
              <button type="button" className="btn-add" onClick={() => setConnecting(true)}>
                Connect account
              </button>
            )
          ) : (
            <span className="muted">No in-panel login for this provider</span>
          )
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

function CustomNodeCard({
  node,
  accounts,
  activeAccounts,
  onChanged,
}: {
  node: Node;
  accounts: number;
  activeAccounts: number;
  onChanged: () => void;
}) {
  const status = activeAccounts > 0 ? "ok" : accounts === 0 ? "disabled" : "down";
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const { busy, error, run } = useAction(onChanged);

  async function addKey(e: React.FormEvent) {
    e.preventDefault();
    const made = await run("add", () =>
      api.post("/api/connections", {
        provider: node.id,
        name: label.trim() || `${node.name} Key`,
        apiKey: apiKey.trim(),
      }),
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
        <code className="provider-id">{node.prefix ? `${node.prefix}/*` : node.id.slice(0, 18)}</code>
        <span className="vendor-badge">{node.type.replace("-compatible", "")}</span>
      </header>
      <div className="provider-body">
        <div className="provider-name">{node.name}</div>
        <div className="provider-meta">
          <span className={`health ${status}`}>{status === "disabled" ? "no accounts" : status}</span>
          <span className="auth-type">{node.apiType ?? "chat"}</span>
          <span className="muted">{accounts > 0 ? `${activeAccounts}/${accounts} active` : "0 accounts"}</span>
        </div>
        <div className="muted" style={{ fontSize: 11, wordBreak: "break-all" }}>
          {node.baseUrl ?? DASH}
        </div>
        {adding && (
          <form className="stack-form" onSubmit={addKey}>
            <input type="text" placeholder="Account label (optional)" value={label} maxLength={200} onChange={(e) => setLabel(e.target.value)} />
            <input type="password" placeholder="API key / token" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} required minLength={8} />
            {error && <div className="bad">{error}</div>}
            <div className="row-actions">
              <button type="submit" className="btn-add" disabled={busy !== null || apiKey.trim().length < 8}>
                {busy === "add" ? "…" : "Save"}
              </button>
              <button type="button" className="btn-ghost" onClick={() => { setAdding(false); setApiKey(""); }}>
                Cancel
              </button>
            </div>
          </form>
        )}
        {editing && (
          <NodeForm
            node={node}
            onDone={() => {
              setEditing(false);
              onChanged();
            }}
          />
        )}
      </div>
      <footer className="row-actions">
        {!adding && !editing && (
          <>
            <button type="button" className="btn-add" onClick={() => setAdding(true)}>
              Add Key
            </button>
            <button type="button" className="btn-ghost" onClick={() => setEditing(true)}>
              Edit
            </button>
            <button
              type="button"
              className="btn-danger"
              disabled={busy !== null}
              onClick={() =>
                run("del", () => api.delete(`/api/provider-nodes/${node.id}`), `Delete custom provider "${node.name}"? Its accounts stay but lose their route.`)
              }
            >
              {busy === "del" ? "…" : "Delete"}
            </button>
          </>
        )}
      </footer>
    </article>
  );
}

function NodeForm({ node, onDone }: { node?: Node; onDone: () => void }) {
  const editing = Boolean(node);
  const [form, setForm] = useState(
    node
      ? {
          type: node.type as "openai-compatible" | "anthropic-compatible",
          name: node.name,
          prefix: node.prefix ?? "",
          apiType: node.apiType ?? "chat",
          baseUrl: node.baseUrl ?? "",
          chatPath: node.chatPath ?? "",
          modelsPath: node.modelsPath ?? "",
        }
      : { ...blankNode },
  );
  const { busy, error, run } = useAction(onDone);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const payload: Record<string, JsonValue> = {
      name: form.name.trim(),
      baseUrl: form.baseUrl.trim(),
      chatPath: form.chatPath.trim() || null,
      modelsPath: form.modelsPath.trim() || null,
    };
    if (!editing) {
      payload.type = form.type;
      payload.prefix = form.prefix.trim();
    }
    if (form.type === "openai-compatible") payload.apiType = form.apiType;
    await run("save", () =>
      editing && node ? api.patch(`/api/provider-nodes/${node.id}`, payload) : api.post("/api/provider-nodes", payload),
    );
  }

  return (
    <form className="stack-form" onSubmit={submit}>
      <label>Name
        <input value={form.name} onChange={set("name")} required maxLength={200} />
      </label>
      <label>Wire format
        <select value={form.type} onChange={set("type")} disabled={editing}>
          <option value="openai-compatible">OpenAI-compatible</option>
          <option value="anthropic-compatible">Anthropic-compatible</option>
        </select>
      </label>
      {!editing && (
        <label>Request prefix
          <input value={form.prefix} onChange={set("prefix")} required maxLength={100} placeholder="muse" />
        </label>
      )}
      {editing && <p className="muted">Prefix <code>{form.prefix || "—"}</code> — fixed after creation.</p>}
      {form.type === "openai-compatible" && (
        <label>API type
          <select value={form.apiType} onChange={set("apiType")}>
            {API_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
      )}
      <label>Base URL
        <input value={form.baseUrl} onChange={set("baseUrl")} required placeholder="https://bridge.example/v1" />
      </label>
      <label>Chat path override
        <input value={form.chatPath} onChange={set("chatPath")} placeholder="/chat/completions" />
      </label>
      <label>Models path override
        <input value={form.modelsPath} onChange={set("modelsPath")} placeholder="/models" />
      </label>
      {error && <div className="bad">{error}</div>}
      <div className="row-actions">
        <button type="submit" className="btn-add" disabled={busy !== null || !form.name.trim() || !form.baseUrl.trim()}>
          {busy === "save" ? "…" : editing ? "Save" : "Create"}
        </button>
        <button type="button" className="btn-ghost" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

function AccountsTable({
  accounts,
  providers,
  nodes,
  loading,
  error,
  onChanged,
}: {
  accounts: Account[];
  providers: Provider[];
  nodes: Node[];
  loading: boolean;
  error: string | null;
  onChanged: () => void;
}) {
  const { busy, error: actionError, run } = useAction(onChanged);
  const [results, setResults] = useState<Record<string, string>>({});
  const [rotatingId, setRotatingId] = useState<string | null>(null);
  const [newKey, setNewKey] = useState("");
  const label = useMemo(() => {
    const m = new Map<string, string>(providers.map((p) => [p.id, p.name ?? p.id]));
    for (const n of nodes) m.set(n.id, n.prefix ? `${n.name} (${n.prefix})` : n.name);
    return m;
  }, [providers, nodes]);
  const sorted = useMemo(
    () => [...accounts].sort((a, b) => (label.get(a.provider) ?? a.provider).localeCompare(label.get(b.provider) ?? b.provider) || String(a.name).localeCompare(String(b.name))),
    [accounts, label],
  );

  async function test(id: string) {
    const out = await run(`test-${id}`, () => api.post<{ ok: boolean; error: string | null }>(`/api/connections/${id}/test`));
    if (out) setResults((r) => ({ ...r, [id]: out.ok ? "key works ✓" : `failed: ${out.error ?? "rejected"}` }));
  }

  async function rotate(e: React.FormEvent, id: string) {
    e.preventDefault();
    const out = await run(`rot-${id}`, () => api.post(`/api/connections/${id}/rotate-key`, { apiKey: newKey.trim() }));
    if (out) {
      setRotatingId(null);
      setNewKey("");
      setResults((r) => ({ ...r, [id]: "key rotated ✓" }));
    }
  }

  return (
    <section className="accounts">
      <h2>Connected accounts <span className="tab-count">{accounts.length}</span></h2>
      {loading && <p>Loading…</p>}
      {error && <p className="bad">{error}</p>}
      {actionError && <p className="bad">{actionError}</p>}
      {!loading && !error && accounts.length === 0 && <p className="muted">No accounts connected yet. Use “Add Key” or “Connect account” above.</p>}
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
              const isApiKey = a.authType === "apikey" || a.authType === "api_key";
              return (
                <tr key={a.id} className={a.isActive ? "" : "row-off"}>
                  <td>{label.get(a.provider) ?? a.provider}</td>
                  <td>
                    <div>{a.name ?? a.id.slice(0, 8)}</div>
                    {rotatingId === a.id && (
                      <form className="inline-form" onSubmit={(e) => rotate(e, a.id)} style={{ marginTop: 6 }}>
                        <input
                          type="password"
                          placeholder="New API key (min 8 chars)"
                          value={newKey}
                          minLength={8}
                          required
                          autoComplete="off"
                          onChange={(e) => setNewKey(e.target.value)}
                        />
                        <button type="submit" className="btn-add" disabled={busy !== null || newKey.trim().length < 8}>
                          Save
                        </button>
                        <button type="button" className="btn-ghost" onClick={() => { setRotatingId(null); setNewKey(""); }}>
                          Cancel
                        </button>
                      </form>
                    )}
                  </td>
                  <td className={!a.isActive ? "muted" : failing ? "bad" : "ok"}>
                    {!a.isActive ? "disabled" : a.testStatus ?? "unchecked"}
                    {a.backoffLevel > 0 ? ` · backoff ${a.backoffLevel}` : ""}
                  </td>
                  <td className="cell-error" title={a.lastError ?? undefined}>
                    {results[a.id] ?? (a.lastError ? a.lastError.replace(/\s+/g, " ").slice(0, 80) : "")}
                  </td>
                  <td className="row-actions">
                    <button type="button" className="btn-ghost" disabled={busy !== null} onClick={() => test(a.id)}>Test</button>
                    {isApiKey && (
                      <button
                        type="button"
                        className="btn-ghost"
                        disabled={busy !== null}
                        onClick={() => {
                          setRotatingId(rotatingId === a.id ? null : a.id);
                          setNewKey("");
                        }}
                      >
                        Rotate key
                      </button>
                    )}
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

/** Paste many keys at once — one per line, "key|name" for a custom label. */
function BulkAdd({ providers, onDone }: { providers: Provider[]; onDone: () => void }) {
  const [provider, setProvider] = useState(providers[0]?.id ?? "");
  const [text, setText] = useState("");
  const [result, setResult] = useState<{ created: { name: string }[]; skipped: { line: string; reason: string }[] } | null>(null);
  const { busy, error, run } = useAction(() => { onDone(); });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0 || !provider) return;
    const out = await run("bulk", () =>
      api.post<{ created: { name: string }[]; skipped: { line: string; reason: string }[] }>("/api/connections/bulk", { provider, lines }),
    );
    if (out) {
      setResult(out);
      setText("");
    }
  }

  return (
    <section className="editor card">
      <h2>Bulk add API-key accounts</h2>
      <form className="stack-form" onSubmit={submit}>
        <label>Provider
          <select value={provider} onChange={(e) => setProvider(e.target.value)}>
            {providers.map((p) => <option key={p.id} value={p.id}>{p.name ?? p.id}</option>)}
          </select>
        </label>
        <label>Keys — one per line, <code>key|name</code> for a label
          <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={"sk-...|farm-account-1\nsk-...|farm-account-2"} required />
        </label>
        {error && <div className="bad">{error}</div>}
        {result && (
          <div className="ok">
            Added {result.created.length} account{result.created.length === 1 ? "" : "s"}
            {result.skipped.length > 0 ? `, skipped ${result.skipped.length} (first: ${result.skipped[0].reason})` : ""}.
          </div>
        )}
        <div className="row-actions">
          <button type="submit" className="btn-add" disabled={busy !== null || !text.trim() || !provider}>
            {busy === "bulk" ? "…" : "Import"}
          </button>
        </div>
      </form>
    </section>
  );
}

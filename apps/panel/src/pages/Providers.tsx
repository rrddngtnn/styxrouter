import { useTranslator } from "../lib/useTranslator.ts";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, KeyRound, Layers, LayoutGrid, Link2, List, Plus, RefreshCw, Settings2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { usePreferences } from "../lib/preferences.tsx";
import {
  accountsForProvider,
  resolveProviderTarget,
  runBulk,
  selectedAccounts,
  type BulkAction,
  type BulkResult,
} from "../lib/account-management.ts";
import { api, type JsonValue } from "../lib/api.ts";
import { Modal, useAction } from "../lib/actions.tsx";
import { DASH } from "../lib/format.ts";
import { useFetch } from "../lib/useFetch.ts";
import { EmptyState, LoadingState } from "../components/PageStates.tsx";
import { filterProviders } from "../lib/provider-search.ts";
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
  const tr = useTranslator();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get("tab");
  const tab: Tab = initialTab === "apikey" || initialTab === "custom" ? initialTab : "oauth";
  const setTab = (next: Tab) => setSearchParams({ tab: next }, { replace: true });

  const state = useFetch<ProvidersResponse>("/api/providers");
  const accountsState = useFetch<{ connections?: Account[] }>("/api/connections");
  const nodesState = useFetch<{ nodes?: Node[] }>("/api/provider-nodes");
  const [editingNode, setEditingNode] = useState<"new" | null>(null);
  const [search, setSearch] = useState("");
  const { providerView, setProviderView } = usePreferences();

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

  const list = filterProviders(tab === "oauth" ? oauthList : apikeyList, search);
  const filteredNodes = filterProviders(nodes, search);
  return (
    <div className="page">
      <h1>{tr("Providers")}</h1>
      <p className="muted">{tr("Select any provider card to open its dedicated page — connect OAuth accounts, add or bulk-import API keys, and run bulk actions on that provider’s accounts.")}</p>

      {state.status === "loading" && <LoadingState label={tr("Loading providers")} />}
      {state.status === "error" && <p className="bad">{state.error.message}</p>}

      {state.status === "ok" && (
        <>
          <div className="tabs" role="tablist">
            <button
              role="tab"
              aria-selected={tab === "oauth"}
              className={tab === "oauth" ? "tab active" : "tab"}
              onClick={() => setTab("oauth")}
            >{tr("OAuth Logins")}<span className="tab-count">{oauthList.length}</span>
            </button>
            <button
              role="tab"
              aria-selected={tab === "apikey"}
              className={tab === "apikey" ? "tab active" : "tab"}
              onClick={() => setTab("apikey")}
            >{tr("API Keys")}<span className="tab-count">{apikeyList.length}</span>
            </button>
            <button
              role="tab"
              aria-selected={tab === "custom"}
              className={tab === "custom" ? "tab active" : "tab"}
              onClick={() => setTab("custom")}
            >{tr("Custom Providers")}<span className="tab-count">{nodes.length}</span>
            </button>
          </div>

          <div className="panel-provider-search">
            <label>{tr("Search providers")}<input type="search" aria-label="Search providers" placeholder={tr("ID, name, vendor or custom prefix")}
                value={search} onChange={(event) => setSearch(event.target.value)} />
            </label>
            {search && <button type="button" className="btn-ghost" onClick={() => setSearch("")}>{tr("Clear search")}</button>}
            <small className="muted provider-result-count" role="status">{tab === "custom" ? filteredNodes.length : list.length} {tr("results")}</small>
            <div className="view-toggle" role="group" aria-label={tr("Provider layout")}>
              <button
                type="button"
                className={providerView === "cards" ? "view-toggle-btn active" : "view-toggle-btn"}
                aria-pressed={providerView === "cards"}
                aria-label={tr("Card layout")}
                title={tr("Card layout")}
                onClick={() => setProviderView("cards")}
              >
                <LayoutGrid size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                className={providerView === "rows" ? "view-toggle-btn active" : "view-toggle-btn"}
                aria-pressed={providerView === "rows"}
                aria-label={tr("Row layout")}
                title={tr("Row layout")}
                onClick={() => setProviderView("rows")}
              >
                <List size={16} aria-hidden="true" />
              </button>
            </div>
          </div>
          {tab !== "custom" ? (
            <div className={providerView === "rows" ? "provider-grid provider-grid-rows" : "provider-grid"}>
              {list.map((p) => (
                <ProviderCard
                  key={p.id + "-" + tab}
                  provider={p}
                  tab={tab}
                  view={providerView}
                  accounts={counts[p.id]?.total ?? 0}
                  activeAccounts={counts[p.id]?.active ?? 0}
                />
              ))}
              {list.length === 0 && <EmptyState title={search.trim() ? tr("No matching providers") : tr("No providers in this category")}
                description={search.trim() ? tr("Try another ID, name or vendor.") : tr("Select another authentication category.")}
                action={search.trim() ? <button type="button" className="btn-ghost" onClick={() => setSearch("")}>Clear search</button> : undefined} />}
            </div>
          ) : (
            <section>
              <p className="muted">{tr("OpenAI- or Anthropic-compatible endpoints routed through their own prefix (e.g.")}<code>muse/model</code>{tr("). Click a custom provider card to manage its endpoint and attached API keys.")}</p>
              <div className="toolbar">
                <button type="button" className="btn-add" onClick={() => setEditingNode("new")}>
                  <Plus size={14} />
                  <span>{tr("New custom provider")}</span>
                </button>
              </div>
              <Modal
                open={editingNode === "new"}
                onOpenChange={(open) => {
                  if (!open) setEditingNode(null);
                }}
                title={tr("New custom provider")}
                description={tr("Register an OpenAI- or Anthropic-compatible upstream endpoint under its own routing prefix.")}
              >
                <NodeForm
                  onDone={() => {
                    setEditingNode(null);
                    toast.success("Custom provider created");
                    refresh();
                  }}
                />
              </Modal>
              <div className="provider-grid">
                {filteredNodes.map((n) => (
                  <CustomNodeCard
                    key={n.id}
                    node={n}
                    accounts={counts[n.id]?.total ?? 0}
                    activeAccounts={counts[n.id]?.active ?? 0}
                  />
                ))}
                {nodesState.status === "loading" && <LoadingState label={tr("Loading custom providers")} />}
                {nodesState.status === "error" && <p className="bad" role="alert">{nodesState.error.message}</p>}
                {nodesState.status === "ok" && filteredNodes.length === 0 && editingNode === null && <EmptyState
                  title={search.trim() ? tr("No matching custom providers") : tr("No custom providers")}
                  description={search.trim() ? tr("Try another name, ID or prefix.") : tr("Add an OpenAI- or Anthropic-compatible endpoint to route models through your own prefix.")}
                  action={search.trim() ? <button type="button" className="btn-ghost" onClick={() => setSearch("")}>Clear search</button>
                    : <button type="button" className="btn-add" onClick={() => setEditingNode("new")}>New custom provider</button>} />}
              </div>
            </section>
          )}

          {Object.keys(vendorCounts).length > 0 && (
            <section className="vendor-summary">
              <h3>{tr("Grouped by vendor")}</h3>
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
  view?: "cards" | "rows";
  accounts: number;
  activeAccounts: number;
}

function ProviderCard({ provider, tab, view = "cards", accounts, activeAccounts }: CardProps) {
  const tr = useTranslator();
  const navigate = useNavigate();
  const name = provider.name ?? provider.id;
  const vendor = provider.vendor ?? "—";
  const status = activeAccounts > 0 ? "ok" : accounts === 0 ? "disabled" : "down";
  const href = `/providers/${encodeURIComponent(provider.id)}?tab=${tab}`;

  return (
    <article
      className={`provider-card status-${status}${view === "rows" ? " provider-card-row" : ""}`}
      tabIndex={0}
      role="link"
      aria-label={`${name} — ${status === "disabled" ? tr("no accounts") : status}, ${accounts} ${tr("accounts")}`}
      onClick={() => navigate(href)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          navigate(href);
        }
      }}
    >
      <header>
        <code className="provider-id">{provider.id}</code>
        <span className="vendor-badge">{vendor}</span>
      </header>
      <div className="provider-body">
        <div className="provider-name">{name}</div>
        <div className="provider-meta">
          <span className={`health ${status}`}>{status === "disabled" ? tr("no accounts") : status}</span>
          <span className="auth-type">{tab === "oauth" ? "oauth" : tab === "apikey" ? "apikey" : provider.authType ?? "—"}</span>
          {accounts > 0 && (
            <span className="muted" title={tr("Accounts whose last check passed, out of all accounts for this provider")}>
              {tr("{0}/{1} active", {0: String(activeAccounts),1: String(accounts)})}
            </span>
          )}
        </div>
      </div>
      <footer>
        <Link
          to={href}
          className="btn-add"
          style={{ textDecoration: "none" }}
          onClick={(e) => e.stopPropagation()}
        >
          {accounts > 0 ? tr("Manage ({0})", {0: String(accounts)}) : tr("Connect")}
        </Link>
      </footer>
    </article>
  );
}

function CustomNodeCard({
  node,
  accounts,
  activeAccounts,
}: {
  node: Node;
  accounts: number;
  activeAccounts: number;
}) {
  const tr = useTranslator();
  const navigate = useNavigate();
  const status = activeAccounts > 0 ? "ok" : accounts === 0 ? "disabled" : "down";
  const href = `/providers/${encodeURIComponent(node.id)}?tab=custom`;

  return (
    <article
      className={`provider-card status-${status}`}
      style={{ cursor: "pointer" }}
      onClick={() => navigate(href)}
    >
      <header>
        <code className="provider-id">{node.prefix ? `${node.prefix}/*` : node.id.slice(0, 18)}</code>
        <span className="vendor-badge">{node.type.replace("-compatible", "")}</span>
      </header>
      <div className="provider-body">
        <div className="provider-name">{node.name}</div>
        <div className="provider-meta">
          <span className={`health ${status}`}>{status === "disabled" ? tr("no accounts") : status}</span>
          <span className="auth-type">{node.apiType ?? "chat"}</span>
          <span className="muted">{accounts > 0 ? tr("{0}/{1} active", {0: String(activeAccounts),1: String(accounts)}) : tr("0 accounts")}</span>
        </div>
        <div className="muted" style={{ fontSize: 14, wordBreak: "break-all" }}>
          {node.baseUrl ?? DASH}
        </div>
      </div>
      <footer className="row-actions">
        <Link
          to={href}
          className="btn-add"
          style={{ textDecoration: "none" }}
          onClick={(e) => e.stopPropagation()}
        >
          {accounts > 0 ? tr("Manage ({0})", {0: String(accounts)}) : tr("Manage")}
        </Link>
      </footer>
    </article>
  );
}

function NodeForm({ node, onDone }: { node?: Node; onDone: () => void }) {
  const tr = useTranslator();
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
      <label>{tr("Name")}<input value={form.name} onChange={set("name")} required maxLength={200} />
      </label>
      <label>{tr("Wire format")}<select value={form.type} onChange={set("type")} disabled={editing}>
          <option value="openai-compatible">{tr("OpenAI-compatible")}</option>
          <option value="anthropic-compatible">{tr("Anthropic-compatible")}</option>
        </select>
      </label>
      {!editing && (
        <label>{tr("Request prefix")}<input value={form.prefix} onChange={set("prefix")} required maxLength={100} placeholder="muse" />
        </label>
      )}
      {editing && <p className="muted">{tr("Prefix")}<code>{form.prefix || "—"}</code>{tr("— fixed after creation.")}</p>}
      {form.type === "openai-compatible" && (
        <label>{tr("API type")}<select value={form.apiType} onChange={set("apiType")}>
            {API_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
      )}
      <label>{tr("Base URL")}<input value={form.baseUrl} onChange={set("baseUrl")} required placeholder="https://bridge.example/v1" />
      </label>
      <label>{tr("Chat path override")}<input value={form.chatPath} onChange={set("chatPath")} placeholder="/chat/completions" />
      </label>
      <label>{tr("Models path override")}<input value={form.modelsPath} onChange={set("modelsPath")} placeholder="/models" />
      </label>
      {error && <div className="bad">{error}</div>}
      <div className="row-actions">
        <button type="submit" className="btn-add" disabled={busy !== null || !form.name.trim() || !form.baseUrl.trim()}>
          {busy === "save" ? "…" : editing ? tr("Save") : tr("Create")}
        </button>
        <button type="button" className="btn-ghost" onClick={onDone}>{tr("Cancel")}</button>
      </div>
    </form>
  );
}

export function ProviderDetail() {
  const tr = useTranslator();
  const { providerId = "" } = useParams<{ providerId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const state = useFetch<ProvidersResponse>("/api/providers");
  const accountsState = useFetch<{ connections?: Account[] }>("/api/connections");
  const nodesState = useFetch<{ nodes?: Node[] }>("/api/provider-nodes");
  const flowsState = useFetch<{ providers?: { id: string; flowType: FlowType; legacyDevice?: boolean; redirectUri?: string }[] }>("/api/oauth/providers");
  const flows = useMemo(
    () => new Map((flowsState.status === "ok" ? flowsState.data.providers ?? [] : []).map((f) => [f.id, f])),
    [flowsState],
  );

  const providers = state.status === "ok" ? state.data.providers ?? [] : [];
  const allAccounts = accountsState.status === "ok" ? accountsState.data.connections ?? [] : [];
  const nodes = nodesState.status === "ok" ? nodesState.data.nodes ?? [] : [];
  const loading = state.status === "loading" || accountsState.status === "loading" || nodesState.status === "loading";

  const refresh = () => {
    state.reload();
    accountsState.reload();
    nodesState.reload();
  };

  const target = useMemo(() => resolveProviderTarget(providerId, providers, nodes), [providerId, providers, nodes]);
  const providerAccounts = useMemo(() => accountsForProvider(allAccounts, providerId), [allAccounts, providerId]);
  const activeCount = useMemo(
    () => providerAccounts.filter((a) => a.isActive && a.testStatus === "active").length,
    [providerAccounts],
  );
  const flow = flows.get(providerId);

  const backTab = searchParams.get("tab") ?? target?.defaultTab ?? "oauth";
  const backHref = `/providers?tab=${encodeURIComponent(backTab)}`;

  const [connecting, setConnecting] = useState(false);
  const [addingKey, setAddingKey] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [editingNode, setEditingNode] = useState(false);
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResults, setBulkResults] = useState<BulkResult[]>([]);
  const [results, setResults] = useState<Record<string, string>>({});
  const [rotatingId, setRotatingId] = useState<string | null>(null);
  const [newKey, setNewKey] = useState("");

  const { busy, error: actionError, run } = useAction(refresh);
  const locked = busy !== null || bulkBusy;
  const rotatingAccount = useMemo(
    () => (rotatingId ? providerAccounts.find((a) => a.id === rotatingId) ?? null : null),
    [rotatingId, providerAccounts],
  );

  async function addSingleKey(e: React.FormEvent) {
    e.preventDefault();
    const made = await run("add-key", () =>
      api.post("/api/connections", {
        provider: providerId,
        name: label.trim() || `${target?.label ?? providerId}-${providerAccounts.length + 1}`,
        apiKey: apiKey.trim(),
      }),
    );
    if (made) {
      setApiKey("");
      setLabel("");
      setAddingKey(false);
      toast.success(`Added API key to ${target?.label ?? providerId}`);
    }
  }

  async function deleteNode() {
    if (!target?.node) return;
    const out = await run(
      "del-node",
      () => api.delete(`/api/provider-nodes/${target.node!.id}`),
      `Delete custom provider "${target.label}"? Its accounts stay but lose their route.`,
    );
    if (out) {
      toast.success(`Deleted custom provider "${target.label}"`);
      navigate("/providers?tab=custom");
    }
  }

  async function bulk(action: BulkAction) {
    const ids = selectedAccounts(providerAccounts, selected);
    if (locked || ids.length === 0) return;
    if (
      action === "delete" &&
      !window.confirm(`Delete ${ids.length} selected account${ids.length === 1 ? "" : "s"} from ${target?.label ?? providerId}? Their stored credentials will be removed.`)
    ) {
      return;
    }
    setBulkBusy(true);
    setBulkResults([]);
    try {
      const out = await runBulk(ids, action, (method, path, body) =>
        method === "PATCH" ? api.patch(path, body!) : method === "DELETE" ? api.delete(path) : api.post(path),
      );
      setBulkResults(out);
      setResults(Object.fromEntries(out.map((r) => [r.id, r.message])));
      const okCount = out.filter((r) => r.ok).length;
      const failCount = out.length - okCount;
      if (failCount === 0) toast.success(`Bulk ${action}: ${okCount}/${out.length} succeeded`);
      else toast.warning(`Bulk ${action}: ${okCount} succeeded, ${failCount} failed`);
      if (action === "delete") {
        setSelected((s) => new Set([...s].filter((id) => !out.some((r) => r.id === id && r.ok))));
      }
    } finally {
      setBulkBusy(false);
      refresh();
    }
  }

  async function test(id: string) {
    const out = await run(`test-${id}`, () => api.post<{ ok: boolean; error: string | null }>(`/api/connections/${id}/test`));
    if (out) {
      setResults((r) => ({ ...r, [id]: out.ok ? "key works ✓" : `failed: ${out.error ?? "rejected"}` }));
      if (out.ok) toast.success("Account test passed");
      else toast.error(out.error ?? "Account test failed");
    }
  }

  async function rotate(e: React.FormEvent, id: string) {
    e.preventDefault();
    const out = await run(`rot-${id}`, () => api.post(`/api/connections/${id}/rotate-key`, { apiKey: newKey.trim() }));
    if (out) {
      setRotatingId(null);
      setNewKey("");
      setResults((r) => ({ ...r, [id]: "key rotated ✓" }));
      toast.success("API key rotated");
    }
  }

  if (loading && !target) {
    return (
      <div className="page">
        <p><Link to={backHref}>{tr("← All Providers")}</Link></p>
        <LoadingState label={tr("Loading provider")} />
      </div>
    );
  }

  if (!target) {
    return (
      <div className="page">
        <p><Link to={backHref}>{tr("← All Providers")}</Link></p>
        <h1>{tr("Provider not found")}</h1>
        <p className="muted">{tr("No provider or custom endpoint matches")}<code>{providerId}</code>.</p>
      </div>
    );
  }

  const ids = selectedAccounts(providerAccounts, selected);
  const status = activeCount > 0 ? "ok" : providerAccounts.length === 0 ? "disabled" : "down";

  return (
    <div className="page">
      <p style={{ marginBottom: 12 }}>
        <Link to={backHref} className="back-link">
          <ArrowLeft size={14} />
          <span>{tr("All Providers")}</span>
        </Link>
      </p>

      <div className="section-head" style={{ alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <h1 style={{ marginBottom: 6, display: "flex", alignItems: "center", gap: 10 }}>
            {target.label}
            <code className="provider-id">{target.code}</code>
            <span className="vendor-badge">{target.badge}</span>
          </h1>
          <div className="provider-meta" style={{ fontSize: 14 }}>
            <span className={`health ${status}`}>{status === "disabled" ? tr("no accounts") : status}</span>
            <span>
              {providerAccounts.length > 0
                ? tr("{0}/{1} active accounts", {0: String(activeCount),1: String(providerAccounts.length)})
                : tr("0 accounts connected")}
            </span>
            {target.isCustomNode && target.node?.baseUrl && (
              <span className="muted">· {target.node.baseUrl}</span>
            )}
          </div>
        </div>

        <div className="row-actions">
          {target.canOauth && flow?.flowType && (
            <button type="button" className="btn-add" onClick={() => setConnecting(true)}>
              <Link2 size={14} />
              <span>{tr("Connect OAuth")}</span>
            </button>
          )}
          {target.canApiKey && (
            <>
              <button type="button" className="btn-add" onClick={() => setAddingKey(true)}>
                <KeyRound size={14} />
                <span>{tr("Add API key")}</span>
              </button>
              <button type="button" className="btn-ghost" onClick={() => setBulkOpen(true)}>
                <Layers size={14} />
                <span>{tr("Bulk import")}</span>
              </button>
            </>
          )}
          {target.isCustomNode && (
            <>
              <button type="button" className="btn-ghost" onClick={() => setEditingNode(true)}>
                <Settings2 size={14} />
                <span>{tr("Edit endpoint")}</span>
              </button>
              <button type="button" className="btn-danger" disabled={locked} onClick={deleteNode}>
                <Trash2 size={14} />
                <span>{tr("Delete provider")}</span>
              </button>
            </>
          )}
          <button type="button" className="btn-ghost" onClick={refresh}>
            <RefreshCw size={14} />
            <span>{tr("Reload")}</span>
          </button>
        </div>
      </div>

      {flow?.flowType && (
        <Modal
          open={connecting}
          onOpenChange={setConnecting}
          title={tr("Connect {0} via OAuth", {0: String(target.label)})}
          description={tr("Authorize an account with the upstream provider and store its encrypted OAuth credentials.")}
        >
          <OAuthConnect
            provider={providerId}
            flow={flow.flowType}
            legacyDevice={flow.legacyDevice}
            redirectUri={flow.redirectUri}
            onDone={() => {
              setConnecting(false);
              toast.success(`Connected ${target.label} OAuth account`);
              refresh();
            }}
            onClose={() => setConnecting(false)}
          />
        </Modal>
      )}

      <Modal
        open={addingKey}
        onOpenChange={(open) => {
          setAddingKey(open);
          if (!open) setApiKey("");
        }}
        title={tr("Add API key — {0}", {0: String(target.label)})}
        description={tr("Credentials are encrypted with AES-256-GCM before being written to SQLite.")}
      >
        <form className="stack-form" onSubmit={addSingleKey}>
          <label>{tr("Account label (optional)")}<input
              type="text"
              placeholder={`${target.label} account`}
              value={label}
              maxLength={200}
              onChange={(e) => setLabel(e.target.value)}
            />
          </label>
          <label>{tr("API key / token")}<input
              type="password"
              placeholder={tr("API key (min 8 chars)")}
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              required
              minLength={8}
            />
          </label>
          {actionError && <div className="bad">{actionError}</div>}
          <div className="row-actions">
            <button type="submit" className="btn-add" disabled={locked || apiKey.trim().length < 8}>
              {busy === "add-key" ? "…" : tr("Save key")}
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setAddingKey(false);
                setApiKey("");
              }}
            >{tr("Cancel")}</button>
          </div>
        </form>
      </Modal>

      <Modal
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        title={tr("Bulk import API keys — {0}", {0: String(target.label)})}
        description={tr("Paste one API key per line. Append |label to assign a custom account name.")}
        maxWidth="580px"
      >
        <BulkAddForProvider
          providerId={providerId}
          onDone={() => {
            refresh();
          }}
          onClose={() => setBulkOpen(false)}
        />
      </Modal>

      {target.node && (
        <Modal
          open={editingNode}
          onOpenChange={setEditingNode}
          title={tr("Edit {0} endpoint", {0: String(target.label)})}
          description={tr("Update the upstream base URL, API type, or path overrides.")}
        >
          <NodeForm
            node={target.node}
            onDone={() => {
              setEditingNode(false);
              toast.success(`Updated ${target.label}`);
              refresh();
            }}
          />
        </Modal>
      )}

      <Modal
        open={rotatingAccount !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRotatingId(null);
            setNewKey("");
          }
        }}
        title={tr("Rotate API key — {0}", {0: String(rotatingAccount?.name ?? rotatingAccount?.id.slice(0, 8) ?? "")})}
        description={tr("Replaces the stored key in place while keeping the account's priority, ID, and usage history.")}
      >
        {rotatingAccount && (
          <form className="stack-form" onSubmit={(e) => rotate(e, rotatingAccount.id)}>
            <label>{tr("New API key")}<input
                type="password"
                placeholder={tr("New API key (min 8 chars)")}
                value={newKey}
                minLength={8}
                required
                autoComplete="off"
                autoFocus
                onChange={(e) => setNewKey(e.target.value)}
              />
            </label>
            {actionError && <div className="bad">{actionError}</div>}
            <div className="row-actions">
              <button type="submit" className="btn-add" disabled={locked || newKey.trim().length < 8}>
                {busy === `rot-${rotatingAccount.id}` ? "…" : tr("Rotate key")}
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  setRotatingId(null);
                  setNewKey("");
                }}
              >{tr("Cancel")}</button>
            </div>
          </form>
        )}
      </Modal>

      <section className="accounts card" style={{ marginTop: 16 }}>
        <div className="section-head" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>{tr("Connected accounts")}<span className="tab-count">{providerAccounts.length}</span>
          </h2>
          {providerAccounts.length > 0 && (
            <div className="toolbar" style={{ margin: 0 }}>
              <label className="check">
                <input
                  type="checkbox"
                  disabled={locked}
                  checked={ids.length === providerAccounts.length && providerAccounts.length > 0}
                  ref={(el) => {
                    if (el) el.indeterminate = ids.length > 0 && ids.length < providerAccounts.length;
                  }}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setSelected(checked ? new Set(providerAccounts.map((a) => a.id)) : new Set());
                  }}
                />{tr("Select all (")}{ids.length}/{providerAccounts.length})
              </label>
              {(
                [
                  ["enable", "Enable"],
                  ["disable", "Disable"],
                  ["cooldown", "Clear cooldown"],
                  ["test", "Test selected"],
                  ["delete", "Delete selected"],
                ] as const
              ).map(([action, text]) => (
                <button
                  key={action}
                  type="button"
                  className={action === "delete" ? "btn-danger" : "btn-ghost"}
                  disabled={locked || ids.length === 0}
                  onClick={() => bulk(action)}
                >
                  {text}
                </button>
              ))}
            </div>
          )}
        </div>

        {bulkBusy && <p role="status">Processing {ids.length} selected account(s) sequentially…</p>}
        {bulkResults.length > 0 && (
          <div role="status" style={{ marginBottom: 12 }}>
            <p>
              Bulk result: <span className="ok">{bulkResults.filter((r) => r.ok).length} succeeded</span>,{" "}
              <span className={bulkResults.some((r) => !r.ok) ? "bad" : "muted"}>
                {bulkResults.filter((r) => !r.ok).length} failed
              </span>
              .
            </p>
          </div>
        )}
        {actionError && !addingKey && <p className="bad">{actionError}</p>}

        {providerAccounts.length === 0 ? (
          <EmptyState title={tr("No connected accounts")} description={tr("Connect an OAuth login or add an API key to {0} using the actions above.", {0: String(target.label)})} />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 36 }} />
                <th>{tr("Account")}</th>
                <th>{tr("Auth")}</th>
                <th>{tr("Status")}</th>
                <th>{tr("Last result / error")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {providerAccounts.map((a) => {
                const failing = a.testStatus !== null && a.testStatus !== "active";
                const isApiKey = a.authType === "apikey" || a.authType === "api_key";
                const labelText = a.name ?? a.id.slice(0, 8);
                return (
                  <tr key={a.id} className={a.isActive ? "" : "row-off"}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={tr("Select {0}", {0: String(labelText)})}
                        disabled={locked}
                        checked={selected.has(a.id)}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setSelected((s) => {
                            const next = new Set(s);
                            if (checked) next.add(a.id);
                            else next.delete(a.id);
                            return next;
                          });
                        }}
                      />
                    </td>
                    <td>
                      <div>{labelText}</div>
                    </td>
                    <td>
                      <span className="auth-type">{isApiKey ? "apikey" : a.authType ?? "oauth"}</span>
                    </td>
                    <td className={!a.isActive ? "muted" : failing ? "bad" : "ok"}>
                      {!a.isActive ? tr("disabled") : a.testStatus ?? tr("unchecked")}
                      {a.backoffLevel > 0 ? ` · backoff ${a.backoffLevel}` : ""}
                    </td>
                    <td className="cell-error" title={a.lastError ?? undefined}>
                      {results[a.id] ?? (a.lastError ? a.lastError.replace(/\s+/g, " ").slice(0, 80) : "")}
                    </td>
                    <td className="row-actions">
                      <button type="button" className="btn-ghost" disabled={locked} onClick={() => test(a.id)}>{tr("Test")}</button>
                      {isApiKey && (
                        <button
                          type="button"
                          className="btn-ghost"
                          disabled={locked}
                          onClick={() => {
                            setRotatingId(a.id);
                            setNewKey("");
                          }}
                        >{tr("Rotate key")}</button>
                      )}
                      {(failing || a.backoffLevel > 0) && (
                        <button
                          type="button"
                          className="btn-ghost"
                          disabled={locked}
                          onClick={() => run(`cool-${a.id}`, () => api.post(`/api/connections/${a.id}/release-cooldown`))}
                        >{tr("Clear error")}</button>
                      )}
                      <button
                        type="button"
                        className="btn-ghost"
                        disabled={locked}
                        onClick={() => run(`toggle-${a.id}`, () => api.patch(`/api/connections/${a.id}`, { isActive: !a.isActive }))}
                      >
                        {a.isActive ? tr("Disable") : tr("Enable")}
                      </button>
                      <button
                        type="button"
                        className="btn-danger"
                        disabled={locked}
                        onClick={() =>
                          run(
                            `del-${a.id}`,
                            () => api.delete(`/api/connections/${a.id}`),
                            `Delete account “${labelText}”? Its stored credentials are removed.`,
                          )
                        }
                      >{tr("Delete")}</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function cmp(a: Provider, b: Provider): number {
  const av = a.vendor ?? "zzz";
  const bv = b.vendor ?? "zzz";
  if (av !== bv) return av.localeCompare(bv);
  return a.id.localeCompare(b.id);
}

/** Paste many keys at once into this specific provider — one per line, "key|name" for a custom label. */
function BulkAddForProvider({
  providerId,
  onDone,
  onClose,
}: {
  providerId: string;
  onDone: () => void;
  onClose: () => void;
}) {
  const tr = useTranslator();
  const [text, setText] = useState("");
  const [result, setResult] = useState<{ created: { name: string }[]; skipped: { line: string; reason: string }[] } | null>(null);
  const { busy, error, run } = useAction(() => {
    onDone();
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return;
    const out = await run("bulk", () =>
      api.post<{ created: { name: string }[]; skipped: { line: string; reason: string }[] }>("/api/connections/bulk", {
        provider: providerId,
        lines,
      }),
    );
    if (out) {
      setResult(out);
      setText("");
      toast.success(`Imported ${out.created.length} key(s)`);
    }
  }

  return (
    <form className="stack-form" onSubmit={submit}>
      <label>{tr("Keys — one per line,")}<code>key|name</code>{tr("for a label")}<textarea
          rows={6}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"sk-...|farm-account-1\nsk-...|farm-account-2"}
          required
        />
      </label>
      {error && <div className="bad">{error}</div>}
      {result && (
        <div className="ok">
          Added {result.created.length} account{result.created.length === 1 ? "" : "s"}
          {result.skipped.length > 0 ? `, skipped ${result.skipped.length} (first: ${result.skipped[0].reason})` : ""}.
        </div>
      )}
      <div className="row-actions">
        <button type="submit" className="btn-add" disabled={busy !== null || !text.trim()}>
          {busy === "bulk" ? "…" : tr("Import keys")}
        </button>
        <button type="button" className="btn-ghost" onClick={onClose}>{tr("Close")}</button>
      </div>
    </form>
  );
}

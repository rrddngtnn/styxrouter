import { useTranslator } from "../lib/useTranslator.ts";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePreferences } from "../lib/preferences.tsx";
import "./models.css";
import { SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, LoadingState } from "../components/PageStates.tsx";
import { TableScroll } from "../components/TableScroll.tsx";
import { Pagination } from "../components/Pagination.tsx";
import { ModelDefaultsPanel } from "../components/settings/RoutingPoliciesPanel.tsx";
import { api } from "../lib/api.ts";
import { Modal } from "../lib/actions.tsx";
import { paginationState } from "../lib/pagination.ts";

type Capability = "supportsThinking" | "supportsVision" | "supportsTools";
interface ModelMetadata {
  provider: string;
  modelId: string;
  contextWindow: number;
  supportsThinking: boolean;
  supportsVision: boolean;
  supportsTools: boolean;
  overrides: { contextWindow: number | null } & Record<Capability, boolean | null>;
}
export interface CatalogModel {
  id: string;
  owned_by: string;
  providerId?: string;
  nodeId?: string | null;
  localId?: string;
  name?: string;
  type?: string;
  root?: string | null;
  parent?: string | null;
  context_length?: number | null;
  thinking?: boolean;
  supportsThinking?: boolean;
  supportsVision?: boolean;
  supportsTools?: boolean;
  capabilities?: {
    thinking?: boolean;
    supportsThinking?: boolean;
    reasoning?: boolean;
    vision?: boolean;
    tool_calling?: boolean;
    supportsTools?: boolean;
  };
}
const capabilities = [
  ["supportsThinking", "Reasoning"],
  ["supportsVision", "Vision"],
  ["supportsTools", "Tools"],
] as const;

export function formatContextTokens(tokens?: number | null): string {
  if (!tokens || tokens <= 0) return "—";
  if (tokens >= 1000000) return `${Math.round((tokens / 1000000) * 10) / 10}M`;
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`;
  return String(tokens);
}

export function extractCatalogCapabilities(row: CatalogModel): string[] {
  const tags: string[] = [];
  const caps = row.capabilities;
  if (row.thinking || row.supportsThinking || caps?.thinking || caps?.supportsThinking || caps?.reasoning) {
    tags.push("Reasoning");
  }
  if (row.supportsVision || caps?.vision) {
    tags.push("Vision");
  }
  if (row.supportsTools || caps?.tool_calling || caps?.supportsTools) {
    tags.push("Tools");
  }
  return tags;
}

export function catalogProviderIdentity(row: CatalogModel, knownProviders: ReadonlySet<string>): string {
  if (row.providerId) return row.providerId;
  const id = row.id.startsWith("no-think/") ? row.id.slice("no-think/".length) : row.id;
  const slash = id.indexOf("/");
  const prefix = slash < 0 ? "" : id.slice(0, slash);
  return knownProviders.has(prefix) ? prefix : row.owned_by;
}

export function groupCatalogModels(catalog: CatalogModel[], filtered: CatalogModel[], identity: (row: CatalogModel) => string = (row) => row.owned_by) {
  const ids = new Set(catalog.map((row) => `${identity(row)}\0${row.id}`));
  const localIds = new Map<string, string | null>();
  for (const row of catalog) {
    if (row.localId === undefined) continue;
    const key = `${identity(row)}\0${row.localId}`;
    const existing = localIds.get(key);
    localIds.set(key, existing === undefined || existing === row.id ? row.id : null);
  }
  const resolve = (row: CatalogModel, ref?: string | null) => {
    if (!ref) return undefined;
    const provider = identity(row);
    if (ids.has(`${provider}\0${ref}`)) return ref;
    const local = localIds.get(`${provider}\0${ref}`);
    if (local) return local;
    const qualified = `${provider}/${ref}`;
    return ids.has(`${provider}\0${qualified}`) ? qualified : undefined;
  };
  const map = new Map<string, { key: string; name: string; rows: CatalogModel[] }>();
  for (const row of filtered) {
    const parent = resolve(row, row.parent);
    const root = resolve(row, row.root);
    const family = (root !== row.id && root) || (parent !== row.id && parent) || row.id;
    const key = `${identity(row)}\0${family}`;
    const group = map.get(key) ?? { key, name: family, rows: [] };
    group.rows.push(row);
    map.set(key, group);
  }
  return [...map.values()];
}

export function catalogMetadataIdentity(row: CatalogModel) {
  return { provider: row.nodeId || row.providerId || row.owned_by, modelId: row.localId ?? row.id };
}

function modelIdForCatalogRow(row: CatalogModel, provider: string) {
  const prefix = `${provider}/`;
  if (row.id.startsWith(`no-think/${prefix}`)) return `no-think/${row.id.slice(`no-think/${prefix}`.length)}`;
  return row.id.startsWith(prefix) ? row.id.slice(prefix.length) : row.id;
}

export function ModelEditor({
  model,
  onSaved,
  onClose,
}: {
  model: ModelMetadata;
  onSaved: (model: ModelMetadata) => void;
  onClose?: () => void;
}) {
  const tr = useTranslator();
  const [context, setContext] = useState(String(model.overrides.contextWindow ?? model.contextWindow));
  const [values, setValues] = useState(model.overrides);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function save() {
    const tokens = context === "" ? null : Number(context);
    if (tokens !== null && (!Number.isSafeInteger(tokens) || tokens <= 0)) {
      setMessage("Enter a positive whole token count, or leave blank for automatic.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const result = await api.patch<{ model: ModelMetadata }>("/api/model-metadata", {
        provider: model.provider,
        modelId: model.modelId,
        contextWindow: tokens,
        ...Object.fromEntries(capabilities.map(([key]) => [key, values[key]])),
      });
      setValues(result.model.overrides);
      onSaved(result.model);
      setMessage("Saved. Runtime and catalog capabilities updated.");
      toast.success(`Updated metadata for ${model.provider}/${model.modelId}`);
      onClose?.();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setMessage(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="model-editor stack-form"
      style={{ maxWidth: "100%" }}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <h2 style={{ margin: "0 0 4px", fontSize: 15 }}>
        <code>
          {model.provider}/{model.modelId}
        </code>
      </h2>
      <label>{tr("Context window (tokens)")}<input
          type="number"
          min="1"
          step="1"
          value={context}
          placeholder={tr("Automatic")}
          onChange={(event) => setContext(event.target.value)}
        />
      </label>
      <div className="model-actions">
        <button type="button" className="btn-ghost" onClick={() => setContext("1000000")}>{tr("Default 1M")}</button>
        <button type="button" className="btn-ghost" onClick={() => setContext("256000")}>{tr("GPT 256K")}</button>
        <button type="button" className="btn-ghost" onClick={() => setContext("")}>{tr("Automatic context")}</button>
      </div>
      <p className="muted" style={{ margin: "2px 0 6px" }}>{tr("Effective context:")}{model.contextWindow.toLocaleString()}{tr("tokens. Blank clears the manual override. Unknown contexts default to 1M for all models and providers.")}</p>
      {capabilities.map(([key, label]) => (
        <label key={key}>
          {label}
          <select
            value={values[key] === null ? "auto" : String(values[key])}
            onChange={(event) =>
              setValues((previous) => ({
                ...previous,
                [key]: event.target.value === "auto" ? null : event.target.value === "true",
              }))
            }
          >
            <option value="auto">Automatic ({model[key] ? tr("enabled") : tr("disabled")})</option>
            <option value="true">{tr("Enabled")}</option>
            <option value="false">{tr("Disabled")}</option>
          </select>
        </label>
      ))}
      <div className="row-actions" style={{ marginTop: 8 }}>
        <button type="submit" className="btn-add" disabled={busy}>
          {busy ? tr("Saving…") : tr("Save")}
        </button>
        {onClose && (
          <button type="button" className="btn-ghost" onClick={onClose}>{tr("Cancel")}</button>
        )}
      </div>
      {message && <p role="status">{message}</p>}
    </form>
  );
}

export function Models() {
  const tr = useTranslator();
  const { language } = usePreferences();
  const railRef = useRef<HTMLElement>(null);
  const [railOverflow, setRailOverflow] = useState(false);
  const [catalog, setCatalog] = useState<CatalogModel[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [inventoryMode, setInventoryMode] = useState(false);
  const [filter, setFilter] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [capabilityFilter, setCapabilityFilter] = useState("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [providerNames, setProviderNames] = useState<Record<string, string>>({});
  const [nodeIds, setNodeIds] = useState<Record<string, string> | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [customOpen, setCustomOpen] = useState(false);
  const [provider, setProvider] = useState("");
  const [modelId, setModelId] = useState("");
  const [model, setModel] = useState<ModelMetadata | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [workspaceTab, setWorkspaceTab] = useState<"catalog" | "defaults">("catalog");

  function loadCatalog() {
    setCatalogLoading(true);
    api
      .get<{ data: CatalogModel[] }>(inventoryMode ? "/api/admin/provider-catalog" : "/v1/models?configuredOnly=true&prefix=canonical")
      .then((result) => setCatalog(result.data.filter((row) => row.owned_by !== "combo")))
      .catch((err) => setError(String(err)))
      .finally(() => setCatalogLoading(false));
  }

  useEffect(() => { loadCatalog(); }, [inventoryMode]);

  useEffect(() => {
    Promise.all([
      api.get<{ providers?: { id: string; name?: string }[] }>("/api/providers"),
      api.get<{ nodes?: { id: string; name: string; prefix: string | null }[] }>("/api/provider-nodes"),
    ]).then(([providers, nodes]) => {
      const names: Record<string, string> = {};
      const ids: Record<string, string> = {};
      for (const p of providers.providers ?? []) names[p.id] = p.name || p.id;
      for (const n of nodes.nodes ?? []) {
        const key = n.prefix || n.id;
        names[key] = n.prefix ? `${n.name} (${n.prefix})` : n.name;
        names[n.id] = names[key];
        ids[key] = n.id;
      }
      setProviderNames(names);
      setNodeIds(ids);
    }).catch((err) => setError(`Provider identity lookup failed: ${String(err)}`));
  }, []);

  async function openModel(prov: string, id: string) {
    setProvider(prov);
    setModelId(id);
    setLoading(true);
    setError("");
    try {
      const result = await api.get<{ model: ModelMetadata }>(
        `/api/model-metadata?${new URLSearchParams({ provider: prov, modelId: id })}`,
      );
      setCustomOpen(false);
      setModel(result.model);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  const knownProviders = useMemo(() => new Set(Object.keys(providerNames)), [providerNames]);
  const identity = (row: CatalogModel) => catalogProviderIdentity(row, knownProviders);
  const providers = useMemo(
    () => [...new Set(catalog.map((r) => catalogProviderIdentity(r, knownProviders)).filter(Boolean))].sort(),
    [catalog, knownProviders],
  );

  const rowType = (row: CatalogModel) => row.type || (inventoryMode ? "unknown" : "chat");
  const matching = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return catalog.filter((r) => {
      if (typeFilter !== "all" && rowType(r) !== typeFilter) return false;
      if (capabilityFilter !== "all" && !extractCatalogCapabilities(r).includes(capabilityFilter)) return false;
      const providerId = catalogProviderIdentity(r, knownProviders);
      return !q || `${r.id} ${r.owned_by} ${providerId} ${providerNames[providerId] ?? ""} ${r.name ?? ""} ${r.type ?? ""}`.toLowerCase().includes(q);
    });
  }, [catalog, filter, typeFilter, capabilityFilter, providerNames, knownProviders, inventoryMode]);
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const check = () => setRailOverflow(rail.scrollWidth > rail.clientWidth + 1);
    const observer = new ResizeObserver(check);
    observer.observe(rail);
    for (const child of rail.children) observer.observe(child);
    check();
    return () => observer.disconnect();
  }, [providers, providerNames, matching, language]);

  const filtered = matching.filter((r) => providerFilter === "all" || identity(r) === providerFilter);
  const types = [...new Set(catalog.map(rowType))].sort();
  const groups = useMemo(() => groupCatalogModels(catalog, filtered, identity), [catalog, filtered, knownProviders]);
  const pg = paginationState(groups.length, pageSize, page);
  const pageGroups = groups.slice(Math.max(0, pg.start - 1), pg.end);

  return (
    <section className="page">
      <div className="section-head" style={{ marginBottom: 16 }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>{tr("Model Capabilities")}</h1>
          <p className="muted" style={{ margin: 0 }}>{tr("Inspect and override context window sizes, reasoning support, vision input, and tool calling per model.")}</p>
        </div>
        {workspaceTab === "catalog" && (
          <button type="button" className="btn-ghost" onClick={() => setCustomOpen(true)}>
            <SlidersHorizontal size={14} />
            <span>{tr("Inspect custom model ID")}</span>
          </button>
        )}
      </div>

      <div className="tabs" role="tablist" aria-label={tr("Models workspace")}>
        <button
          type="button"
          role="tab"
          aria-selected={workspaceTab === "catalog"}
          className={workspaceTab === "catalog" ? "tab active" : "tab"}
          onClick={() => setWorkspaceTab("catalog")}
        >
          <span>{tr("Catalog Inspector")}</span>
          <span className="tab-count">{catalog.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={workspaceTab === "defaults"}
          className={workspaceTab === "defaults" ? "tab active" : "tab"}
          onClick={() => setWorkspaceTab("defaults")}
        >
          <span>{tr("Thinking & Modality Defaults")}</span>
        </button>
      </div>

      {workspaceTab === "defaults" && <ModelDefaultsPanel />}
      {workspaceTab === "catalog" && (
        <>

      <label className="model-inventory-toggle"><input type="checkbox" checked={inventoryMode} onChange={(e) => { setInventoryMode(e.target.checked); setProviderFilter("all"); setPage(1); }} /> {tr("Show provider inventory (partial; not the served catalog)")}</label>
      {inventoryMode && <p className="muted">{tr("Registry, stored sync and custom models, unambiguous alias targets, and selected generated effort variants. This partial inventory may include inactive or unavailable models and omits other catalog sources.")}</p>}
      <div className="model-inspector-layout">
      <div className="model-category-wrap">
      {railOverflow && <p className="model-rail-hint">{language === "id" ? "Geser penyedia ke samping ↔" : "Scroll providers horizontally ↔"}</p>}
      <nav ref={railRef} className="model-category-rail" aria-label={tr("Model providers")}>
        {["all", ...providers].map((p) => <button key={p} type="button" className="btn-ghost" aria-pressed={providerFilter === p} onClick={() => { setProviderFilter(p); setPage(1); }}>
          {p === "all" ? tr("All") : providerNames[p] || p} ({p === "all" ? matching.length : matching.filter((r) => identity(r) === p).length})
        </button>)}
      </nav>
      </div>
      <div style={{ minWidth: 0 }}>
      <div className="toolbar">
        <input
          type="search"
          aria-label={tr("Search models")}
          placeholder={tr("Search models")}
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setPage(1);
          }}
          style={{ minWidth: 0, width: "min(340px, 100%)" }}
        />
        <select
          aria-label={tr("Filter by provider")}
          value={providerFilter}
          onChange={(e) => {
            setProviderFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="all">{tr("All providers (")}{matching.length})</option>
          {providers.map((p) => (
            <option key={p} value={p}>
              {providerNames[p] || p} ({matching.filter((r) => identity(r) === p).length})
            </option>
          ))}
        </select>
        <select aria-label={tr("Filter by type")} value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}>
          <option value="all">{tr("All types")}</option>{types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select aria-label={tr("Filter by capability")} value={capabilityFilter} onChange={(e) => { setCapabilityFilter(e.target.value); setPage(1); }}>
          <option value="all">{tr("All capabilities")}</option>{capabilities.map(([, label]) => <option key={label} value={label}>{tr(label)}</option>)}
        </select>
        <span className="muted" style={{ marginLeft: "auto" }}>
          {filtered.length} {tr(filtered.length === 1 ? "model" : "models")}
        </span>
      </div>

      {error && (
        <p role="alert" className="bad">
          {error}
        </p>
      )}

      {catalogLoading && <LoadingState label={tr("Loading model catalog")} />}

      {!catalogLoading && filtered.length === 0 && (
        <EmptyState
          title={tr("No matching models")}
          description={
            filter || providerFilter !== "all" || typeFilter !== "all" || capabilityFilter !== "all"
              ? tr("Try clearing your search or switching the provider filter.")
              : tr("Connect a provider to populate the model catalog.")
          }
          action={
            (filter || providerFilter !== "all" || typeFilter !== "all" || capabilityFilter !== "all") ? (
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  setFilter("");
                  setProviderFilter("all");
                  setTypeFilter("all");
                  setCapabilityFilter("all");
                  setPage(1);
                }}
              >
                Reset filters
              </button>
            ) : undefined
          }
        />
      )}

      {!catalogLoading && filtered.length > 0 && (
        <>
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <TableScroll label={tr("Models table")} stickyPrimary>
            <table className="table">
              <thead>
                <tr>
                  <th>{tr("Canonical ID")}</th>
                  <th>{tr("Provider")}</th>
                  <th>{tr("Type")}</th>
                  <th>{tr("Context")}</th>
                  <th>{tr("Capabilities")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {pageGroups.flatMap((group) => {
                  const summary = group.rows.length > 1 ? <tr key={`${group.key}-summary`}>
                    <td><button type="button" className="btn-ghost" aria-expanded={expanded.has(group.key)} onClick={() => setExpanded((previous) => { const next = new Set(previous); if (next.has(group.key)) next.delete(group.key); else next.add(group.key); return next; })}>{group.name} · {group.rows.length} models</button></td>
                    <td>{providerNames[identity(group.rows[0])] || identity(group.rows[0])}</td>
                    <td>—</td>
                    <td>{[...new Set(group.rows.map((r) => formatContextTokens(r.context_length)))].join(" / ")}</td>
                    <td>{tr("Available across variants:")} {[...new Set(group.rows.flatMap(extractCatalogCapabilities))].join(", ") || "—"}</td><td />
                  </tr> : null;
                  const visible = group.rows.length === 1 || expanded.has(group.key) ? group.rows : [];
                  return [summary, ...visible.map((row, index) => {
                  const tags = extractCatalogCapabilities(row);
                  return (
                    <tr key={`${group.key}-${row.id}-${row.type || "chat"}-${index}`}>

                      <td>
                        <code>{row.id}</code>
                      </td>
                      <td>
                        <a
                          className="vendor-badge"
                          href={`/panel/providers/${encodeURIComponent(nodeIds?.[identity(row)] || identity(row))}?tab=models`}
                          style={{ textDecoration: "none" }}
                        >
                          {providerNames[identity(row)] || identity(row)}
                        </a>
                      </td>
                      <td className="muted">{rowType(row)}</td>
                      <td>
                        <code>{formatContextTokens(row.context_length)}</code>
                      </td>
                      <td>
                        {tags.length > 0 ? (
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {tags.map((t) => (
                              <span key={t} className="vendor-badge">
                                {tr(t)}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="row-actions">
                        <button
                          type="button"
                          className="btn-ghost"
                          disabled={loading || nodeIds === null}
                          onClick={() => { const explicit = catalogMetadataIdentity(row); void openModel(row.providerId ? explicit.provider : (nodeIds?.[identity(row)] || identity(row)), row.providerId ? explicit.modelId : modelIdForCatalogRow(row, identity(row))); }}
                        >{tr("Configure")}</button>
                      </td>
                    </tr>
                  );
                  })];
                })}
              </tbody>
            </table>
            </TableScroll>
          </div>
          <Pagination
            total={groups.length}
            page={pg.page}
            pageSize={pg.pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            pageSizeOptions={[15, 20, 50, 100]}
            itemLabel="families"
            label={tr("Models pagination")}
          />
        </>
      )}

      </div>
      </div>
        </>
      )}
      <Modal
        open={customOpen}
        onOpenChange={setCustomOpen}
        title={tr("Inspect or override custom model ID")}
        description={tr("Look up any provider and model ID directly, even if it is not currently listed in the active catalog.")}
      >
        <form
          className="stack-form"
          onSubmit={(event) => {
            event.preventDefault();
            void openModel(provider, modelId);
          }}
        >
          <div className="two-col" style={{ gap: 12 }}>
            <label>{tr("Provider")}<input
                required
                placeholder="e.g. antigravity, codex, glm"
                value={provider}
                onChange={(event) => setProvider(event.target.value)}
              />
            </label>
            <label>{tr("Model ID")}<input
                required
                placeholder="e.g. gemini-4-argon-high"
                value={modelId}
                onChange={(event) => setModelId(event.target.value)}
              />
            </label>
          </div>
          <div className="row-actions">
            <button type="submit" className="btn-add" disabled={loading || !provider.trim() || !modelId.trim()}>
              {loading ? tr("Loading…") : tr("Inspect model")}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setCustomOpen(false)}>{tr("Cancel")}</button>
          </div>
        </form>
      </Modal>

      <Modal
        open={model !== null}
        onOpenChange={(open) => {
          if (!open) setModel(null);
        }}
        title={tr("Configure model capabilities")}
        description={tr("Override context length or capability flags advertised by /v1/models and enforced at dispatch.")}
      >
        {model && (
          <ModelEditor
            key={`${model.provider}/${model.modelId}`}
            model={model}
            onSaved={(saved) => {
              setModel(saved);
              loadCatalog();
            }}
            onClose={() => setModel(null)}
          />
        )}
      </Modal>
    </section>
  );
}

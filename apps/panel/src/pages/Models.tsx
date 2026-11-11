import {useBlocker} from "react-router-dom";
import {useFilterLabels} from "../components/ProgressiveFilters";
import {ProgressiveFilters,InspectionFallback} from "../components/ProgressiveFilters";
import {useFilterQuery,pageValues,pageSizes} from "../lib/filter-query";
import {ResourceInspector,ResourceRows,ResourceRow,useResourceInspection} from "../components/ResourceWorkspace";
import {useWorkspaceURL} from "../lib/workspace-url";
import { useWorkspaceTabs } from "../lib/workspace-tabs.ts";
import { useTranslator } from "../lib/useTranslator.ts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePreferences } from "../lib/preferences.tsx";
import "./models.css";
import "./model-capabilities.css";
import { SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, LoadingState } from "../components/PageStates.tsx";
import { TableScroll } from "../components/TableScroll.tsx";
import { Pagination } from "../components/Pagination.tsx";
import { ModelDefaultsPanel } from "../components/settings/RoutingPoliciesPanel.tsx";
import { api } from "../lib/api.ts";
import { Modal } from "../lib/actions.tsx";
import { useConfirmation } from "../components/ConfirmationDialog";
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
  onDirtyChange,
}: {
  model: ModelMetadata;
  onSaved: (model: ModelMetadata) => void | Promise<void>;
  onClose?: () => void;
  onDirtyChange?: (dirty:boolean)=>void;
}) {
  const tr = useTranslator();
  const [context, setContext] = useState(String(model.overrides.contextWindow ?? model.contextWindow));
  const [values, setValues] = useState(model.overrides);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const confirmation=useConfirmation();
  const closing=useRef(false);
  const labels=useFilterLabels();
  const initial=useRef({context:String(model.overrides.contextWindow??model.contextWindow),values:JSON.stringify(model.overrides)});
  const dirty=context!==initial.current.context||JSON.stringify(values)!==initial.current.values;
  useEffect(()=>{onDirtyChange?.(dirty&&!busy);return()=>onDirtyChange?.(false);},[dirty,busy,onDirtyChange]);
  useEffect(()=>{if(!dirty)return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};window.addEventListener("beforeunload",warn);return()=>window.removeEventListener("beforeunload",warn);},[dirty]);
  const close=async()=>{if(closing.current)return;closing.current=true;try{if(onDirtyChange||!dirty||await confirmation.confirm({title:labels.discard,description:labels.discard,resource:`${model.provider}/${model.modelId}`,action:tr("Discard changes"),danger:true}))onClose?.();}finally{closing.current=false;}};
  const [message, setMessage] = useState("");
  async function save() {
    if (saving.current) return;
    const tokens = context === "" ? null : Number(context);
    if (tokens !== null && (!Number.isSafeInteger(tokens) || tokens <= 0)) {
      setMessage("Enter a positive whole token count, or leave blank for automatic.");
      return;
    }
    saving.current = true;
    setBusy(true);
    setMessage("");
    try {
      const result = await api.patch<{ model: ModelMetadata }>("/api/model-metadata", {
        provider: model.provider,
        modelId: model.modelId,
        contextWindow: tokens,
        ...Object.fromEntries(capabilities.map(([key]) => [key, values[key]])),
      });
      initial.current={context,values:JSON.stringify(result.model.overrides)};
      setValues(result.model.overrides);
      await onSaved(result.model);
      setMessage("Saved. Runtime and catalog capabilities updated.");
      toast.success(`Updated metadata for ${model.provider}/${model.modelId}`);
      onClose?.();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setMessage(msg);
      toast.error(msg);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <form
      className="model-editor stack-form" data-dirty={dirty}
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
      <fieldset className="capability-context"><legend>{tr("Context")}</legend>
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
      <p className="muted capability-context-help">{tr("Effective context:")} {model.contextWindow.toLocaleString()} {tr("tokens. Blank clears the manual override. Unknown contexts default to 1M for all models and providers.")}</p>
      </fieldset>
      <fieldset className="capability-flags"><legend>{tr("Capabilities")}</legend>
      {capabilities.map(([key, label]) => (
        <label key={key}>
          {tr(label)}
          <select
            value={values[key] === null ? "auto" : String(values[key])}
            onChange={(event) =>
              setValues((previous) => ({
                ...previous,
                [key]: event.target.value === "auto" ? null : event.target.value === "true",
              }))
            }
          >
            <option value="auto">{tr("Automatic")} ({model[key] ? tr("enabled") : tr("disabled")})</option>
            <option value="true">{tr("Enabled")}</option>
            <option value="false">{tr("Disabled")}</option>
          </select>
        </label>
      ))}
      </fieldset>
      <div className="row-actions capability-editor-actions">
        <button type="submit" className="btn-add" disabled={busy}>
          {busy ? tr("Saving…") : tr("Save")}
        </button>
        {onClose && (
          <button type="button" className="btn-ghost" onClick={close}>{tr("Cancel")}</button>
        )}
      </div>
      {message && <p role="status">{message}</p>}
      {confirmation.dialog}
    </form>
  );
}

export function Models() {
  const tr = useTranslator();
  const labels=useFilterLabels();
  const [editorDirty,setEditorDirty]=useState(false);
  const editorDirtyRef=useRef(false);
  const updateEditorDirty=useCallback((dirty:boolean)=>{editorDirtyRef.current=dirty;setEditorDirty(dirty);},[]);
  const confirmation=useConfirmation();
  const reviewing=useRef(false);
  const blocker=useBlocker(editorDirty);
  useEffect(()=>{if(blocker.state!=="blocked"||reviewing.current)return;reviewing.current=true;void confirmation.confirm({title:labels.discard,description:labels.discard,resource:"/panel/models",action:tr("Discard changes"),danger:true}).then(accepted=>{if(accepted)blocker.proceed();else blocker.reset();}).finally(()=>{reviewing.current=false;});},[blocker,labels.discard]);
  const { language } = usePreferences();
  const railRef = useRef<HTMLElement>(null);
  const [railOverflow, setRailOverflow] = useState(false);
  const [catalog, setCatalog] = useState<CatalogModel[]>([]);
  const inspection=useResourceInspection(catalog,row=>`${row.providerId??row.owned_by}/${row.id}/${row.type??"chat"}`);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [providerNames, setProviderNames] = useState<Record<string, string>>({});
  const query=useFilterQuery({inventory:["false","true"],provider:["all",...new Set(catalog.map(r=>catalogProviderIdentity(r,new Set(Object.keys(providerNames)))))],type:["all",...new Set(catalog.map(r=>r.type??"chat"))],capability:["all","Reasoning","Vision","Tools"],page:pageValues,size:pageSizes},{inventory:"false",provider:"all",type:"all",capability:"all",page:"1",size:"20"});
  const inventoryMode=query.values.inventory==="true";const setInventoryMode=(v:boolean)=>query.commit({inventory:String(v),provider:"all",page:"1"});
  const [filter, setFilter] = useState("");
  const providerFilter=query.values.provider,typeFilter=query.values.type,capabilityFilter=query.values.capability;
  const setProviderFilter=(v:string)=>query.commit({provider:v,page:"1"});const setTypeFilter=(v:string)=>query.commit({type:v,page:"1"});const setCapabilityFilter=(v:string)=>query.commit({capability:v,page:"1"});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [nodeIds, setNodeIds] = useState<Record<string, string> | null>(null);
  const page=Number(query.values.page),pageSize=Number(query.values.size);const setPage=(n:number)=>query.commit({page:String(n)});const setPageSize=(n:number)=>query.commit({size:String(n),page:"1"});
  const [customOpen, setCustomOpen] = useState(false);
  const [provider, setProvider] = useState("");
  const [modelId, setModelId] = useState("");
  const [model, setModel] = useState<ModelMetadata | null>(null);
  const modelGeneration=useRef(0);
  const [modelInspection, setModelInspection] = useState<string | null>(null);
  useEffect(()=>{if(inspection.mobile){modelGeneration.current++;setModel(null);setLoading(false);setError("");}},[inspection.inspect,inspection.mobile]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [workspaceTab, setWorkspaceTab] = useWorkspaceURL(["catalog","defaults"] as const,"catalog");
  const workspaceTabs = useWorkspaceTabs(workspaceTab);

  const catalogGeneration=useRef(0);
  function loadCatalog() {
    const generation=++catalogGeneration.current;
    setCatalogLoading(true);
    return api
      .get<{ data: CatalogModel[] }>(inventoryMode ? "/api/admin/provider-catalog" : "/v1/models?configuredOnly=true&prefix=canonical")
      .then((result) => {if(generation===catalogGeneration.current)setCatalog(result.data.filter((row) => row.owned_by !== "combo"));})
      .catch((err) => {if(generation===catalogGeneration.current)setError(String(err));})
      .finally(() => {if(generation===catalogGeneration.current)setCatalogLoading(false);});
  }

  useEffect(() => { loadCatalog();return()=>{++catalogGeneration.current;}; }, [inventoryMode]);

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
    const generation=++modelGeneration.current;
    setModel(null);
    setProvider(prov);
    setModelId(id);
    setLoading(true);
    setError("");
    try {
      const result = await api.get<{ model: ModelMetadata }>(
        `/api/model-metadata?${new URLSearchParams({ provider: prov, modelId: id })}`,
      );
      if(generation===modelGeneration.current){
        setCustomOpen(false);
        setModelInspection(inspection.inspect);
        setModel(result.model);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if(generation===modelGeneration.current){setError(msg);toast.error(msg);}
    } finally {
      if(generation===modelGeneration.current)setLoading(false);
    }
  }

  const knownProviders = useMemo(() => new Set(Object.keys(providerNames)), [providerNames]);
  const identity = (row: CatalogModel) => catalogProviderIdentity(row, knownProviders);
  const providers = useMemo(
    () => [...new Set(catalog.map((r) => catalogProviderIdentity(r, knownProviders)).filter(Boolean))].sort(),
    [catalog, knownProviders],
  );

  const selectedRow = inspection.selected;
  const selectedProvider = selectedRow && nodeIds !== null ? (selectedRow.providerId ? catalogMetadataIdentity(selectedRow).provider : (nodeIds[identity(selectedRow)] || identity(selectedRow))) : null;
  const selectedModelId = selectedRow ? (selectedRow.providerId ? catalogMetadataIdentity(selectedRow).modelId : modelIdForCatalogRow(selectedRow, identity(selectedRow))) : null;
  useEffect(()=>{if(!inspection.mobile||selectedProvider===null||selectedModelId===null)return;void openModel(selectedProvider,selectedModelId);},[inspection.mobile,inspection.inspect,selectedProvider,selectedModelId]);
  const ownedModel = inspection.mobile && inspection.inspect && modelInspection !== inspection.inspect ? null : model;
  async function closeEditor() {
    if(inspection.mobile&&inspection.inspect){inspection.close();return;}
    if(reviewing.current)return;
    const target=model;
    if(!editorDirtyRef.current){setModel(null);return;}
    reviewing.current=true;
    try {if(await confirmation.confirm({title:labels.discard,description:labels.discard,resource:target?`${target.provider}/${target.modelId}`:"/panel/models",action:tr("Discard changes"),danger:true}))setModel(current=>current===target?null:current);}finally{reviewing.current=false;}
  }
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
  const modelUnit = tr(filtered.length === 1 ? "model" : "models");
  // Pagination slices families, while the toolbar counts individual model rows.
  const groupedModels = groups.some(group => group.rows.length > 1);
  const pageEntity = groupedModels
    ? (language === "id" ? "keluarga model" : groups.length === 1 ? "model family" : "model families")
    : modelUnit;
  const pg = paginationState(groups.length, pageSize, page);
  useEffect(()=>{if(!catalogLoading&&page!==pg.page)query.commit({page:String(pg.page)},true);},[page,pg.page,!catalogLoading]);
  const pageGroups = groups.slice(Math.max(0, pg.start - 1), pg.end);

  return (
    <section className={`page r6-models ${inspection.mobile&&inspection.inspect?"r6-detail-page":""}`}>
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

      {inspection.mobile ? <label className="mobile-category-select">{tr("Models workspace")}<select aria-label={tr("Models workspace")} value={workspaceTab} onChange={e=>setWorkspaceTab(e.target.value as typeof workspaceTab)}><option value="catalog">{tr("Catalog Inspector")}</option><option value="defaults">{tr("Thinking & Modality Defaults")}</option></select></label> : <div className="tabs" role="tablist" onKeyDown={workspaceTabs.onKeyDown} aria-label={tr("Models workspace")}>
        <button
          type="button"
          role="tab"
          {...workspaceTabs.tabProps("catalog")}
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
          {...workspaceTabs.tabProps("defaults")}
          aria-selected={workspaceTab === "defaults"}
          className={workspaceTab === "defaults" ? "tab active" : "tab"}
          onClick={() => setWorkspaceTab("defaults")}
        >
          <span>{tr("Thinking & Modality Defaults")}</span>
        </button>
      </div>}

      <div {...workspaceTabs.panelProps} hidden={inspection.mobile && !!inspection.inspect}>
      {workspaceTab === "defaults" && <ModelDefaultsPanel />}
      {workspaceTab === "catalog" && (
        <>

      {!inspection.mobile && <label className="model-inventory-toggle"><input type="checkbox" checked={inventoryMode} onChange={(e) => { setInventoryMode(e.target.checked); }} /> {language==="id"?"Tampilkan inventaris penyedia (sebagian; bukan katalog layanan)":tr("Show provider inventory (partial; not the served catalog)")}</label>}
      {inventoryMode && <p className="muted">{tr("Registry, stored sync and custom models, unambiguous alias targets, and selected generated effort variants. This partial inventory may include inactive or unavailable models and omits other catalog sources.")}</p>}
      <div className="model-inspector-layout">
      <div className="model-category-wrap">
      {railOverflow && <p className="model-rail-hint">{language === "id" ? "Geser penyedia ke samping ↔" : "Scroll providers horizontally ↔"}</p>}
      <nav ref={railRef} className="model-category-rail" aria-label={tr("Model providers")}>
        {["all", ...providers].map((p) => <button key={p} type="button" className="btn-ghost" aria-pressed={providerFilter === p} onClick={() => { setProviderFilter(p); }}>
          {p === "all" ? tr("All") : providerNames[p] || p} ({p === "all" ? matching.length : matching.filter((r) => identity(r) === p).length})
        </button>)}
      </nav>
      </div>
      <div style={{ minWidth: 0 }}>
      {inspection.mobile ? <div className="toolbar"><input type="search" aria-label={tr("Search models")} placeholder={tr("Search models")} value={filter} onChange={e=>{setFilter(e.target.value);setPage(1);}}/><ProgressiveFilters value={{provider:providerFilter,type:typeFilter,capability:capabilityFilter,inventory:String(inventoryMode)}} defaults={{provider:"all",type:"all",capability:"all",inventory:"false"}} onApply={v=>query.commit({...v,page:"1"})}>{(draft,setDraft)=><><label>{tr("Filter by provider")}<select aria-label={tr("Filter by provider")} value={draft.provider} onChange={e=>setDraft({...draft,provider:e.target.value})}><option value="all">{tr("All")}</option>{providers.map(p=><option key={p} value={p}>{providerNames[p]||p}</option>)}</select></label><label>{language==="id"?"Filter menurut tipe":tr("Filter by type")}<select aria-label={language==="id"?"Filter menurut tipe":tr("Filter by type")} value={draft.type} onChange={e=>setDraft({...draft,type:e.target.value})}><option value="all">{language==="id"?"Semua tipe":tr("All types")}</option>{types.map(t=><option key={t}>{t}</option>)}</select></label><label>{language==="id"?"Filter menurut kapabilitas":tr("Filter by capability")}<select aria-label={language==="id"?"Filter menurut kapabilitas":tr("Filter by capability")} value={draft.capability} onChange={e=>setDraft({...draft,capability:e.target.value})}><option value="all">{language==="id"?"Semua kapabilitas":tr("All capabilities")}</option>{capabilities.map(([,label])=><option key={label} value={label}>{tr(label)}</option>)}</select></label><label><input type="checkbox" checked={draft.inventory==="true"} onChange={e=>setDraft({...draft,inventory:String(e.target.checked),provider:"all"})}/>{language==="id"?"Tampilkan inventaris penyedia (sebagian; bukan katalog layanan)":tr("Show provider inventory (partial; not the served catalog)")}</label></>}</ProgressiveFilters><span className="muted">{filtered.length} {modelUnit}</span></div> : <div className="toolbar">
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
          }}
        >
          <option value="all">{tr("All providers (")}{matching.length})</option>
          {providers.map((p) => (
            <option key={p} value={p}>
              {providerNames[p] || p} ({matching.filter((r) => identity(r) === p).length})
            </option>
          ))}
        </select>
        <select aria-label={language==="id"?"Filter menurut tipe":tr("Filter by type")} value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); }}>
          <option value="all">{language==="id"?"Semua tipe":tr("All types")}</option>{types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select aria-label={language==="id"?"Filter menurut kapabilitas":tr("Filter by capability")} value={capabilityFilter} onChange={(e) => { setCapabilityFilter(e.target.value); }}>
          <option value="all">{language==="id"?"Semua kapabilitas":tr("All capabilities")}</option>{capabilities.map(([, label]) => <option key={label} value={label}>{tr(label)}</option>)}
        </select>
        <span className="muted" style={{ marginLeft: "auto" }}>
          {filtered.length} {modelUnit}
        </span>
      </div>

      }

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
                  query.commit({provider:"all",type:"all",capability:"all",page:"1"});
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
            {inspection.mobile ? <ResourceRows label={tr("Models")}>{pageGroups.flatMap(group=>group.rows).map(row=><ResourceRow key={`${row.providerId??row.owned_by}/${row.id}/${row.type??"chat"}`} title={row.name??row.id} onOpen={()=>inspection.open(row)} summary={<><code>{row.id}</code><p>{providerNames[identity(row)]||identity(row)} · {rowType(row)}</p><p>{formatContextTokens(row.context_length)} · {extractCatalogCapabilities(row).map(tag=>tr(tag)).join(", ")||"—"}</p></>}/>)}</ResourceRows> : <TableScroll label={tr("Models table")} stickyPrimary>
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
            </TableScroll>}
          </div>
          <Pagination
            total={groups.length}
            page={pg.page}
            pageSize={pg.pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            pageSizeOptions={[15, 20, 50, 100]}
            itemLabel={pageEntity}
            label={tr("Models pagination")}
          />
        </>
      )}

      </div>
      </div>
        </>
      )}
      </div>
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

      <ResourceInspector
        open={inspection.mobile?!!inspection.inspect || model!==null:model !== null}
        onOpenChange={(open) => {
          if (!open) void closeEditor();
        }}
        title={tr("Configure model capabilities")}
        description={tr("Override context length or capability flags advertised by /v1/models and enforced at dispatch.")}
      >
        {!ownedModel && <InspectionFallback loading={catalogLoading||loading}/>}
        {error && <p role="alert" className="bad">{error}</p>}
        {ownedModel && (
          <ModelEditor
            key={`${ownedModel.provider}/${ownedModel.modelId}`}
            model={ownedModel}
            onDirtyChange={updateEditorDirty}
            onSaved={async (saved) => {
              setModel(saved);
              await loadCatalog();
            }}
            onClose={() => {void closeEditor();}}
          />
        )}
      </ResourceInspector>
      {confirmation.dialog}
    </section>
  );
}

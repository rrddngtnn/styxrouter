import { useEffect, useState } from "react";
import { api } from "../lib/api.ts";

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
interface CatalogModel { id: string; owned_by: string }
const capabilities = [["supportsThinking", "Reasoning"], ["supportsVision", "Vision"], ["supportsTools", "Tools"]] as const;

export function ModelEditor({ model, onSaved }: { model: ModelMetadata; onSaved: (model: ModelMetadata) => void }) {
  const [context, setContext] = useState(String(model.overrides.contextWindow ?? model.contextWindow));
  const [values, setValues] = useState(model.overrides);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function save() {
    const tokens = context === "" ? null : Number(context);
    if (tokens !== null && (!Number.isSafeInteger(tokens) || tokens <= 0)) { setMessage("Enter a positive whole token count, or leave blank for automatic."); return; }
    setBusy(true); setMessage("");
    try {
      const result = await api.patch<{ model: ModelMetadata }>("/api/model-metadata", {
        provider: model.provider, modelId: model.modelId, contextWindow: tokens,
        ...Object.fromEntries(capabilities.map(([key]) => [key, values[key]])),
      });
      setValues(result.model.overrides);
      onSaved(result.model);
      setMessage("Saved. Runtime and catalog capabilities updated.");
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  return <form className="model-editor card" onSubmit={event => { event.preventDefault(); void save(); }}>
    <h2>{model.provider}/{model.modelId}</h2>
    <label>Context window (tokens)
      <input type="number" min="1" step="1" value={context} placeholder="Automatic" onChange={event => setContext(event.target.value)} />
    </label>
    <div className="model-actions">
      <button type="button" onClick={() => setContext("1000000")}>Default 1M</button>
      <button type="button" onClick={() => setContext("256000")}>GPT 256K</button>
      <button type="button" onClick={() => setContext("")}>Automatic context</button>
    </div>
    <p>Effective context: {model.contextWindow.toLocaleString()} tokens. Blank clears the manual override. Unknown contexts default to 1M; use GPT 256K for GPT models.</p>
    {capabilities.map(([key, label]) => <label key={key}>{label}
      <select value={values[key] === null ? "auto" : String(values[key])} onChange={event => setValues(previous => ({ ...previous, [key]: event.target.value === "auto" ? null : event.target.value === "true" }))}>
        <option value="auto">Automatic ({model[key] ? "enabled" : "disabled"})</option>
        <option value="true">Enabled</option><option value="false">Disabled</option>
      </select>
    </label>)}
    <button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
    {message && <p role="status">{message}</p>}
  </form>;
}

export function Models() {
  const [catalog, setCatalog] = useState<CatalogModel[]>([]);
  const [provider, setProvider] = useState("");
  const [modelId, setModelId] = useState("");
  const [model, setModel] = useState<ModelMetadata | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    api.get<{ data: CatalogModel[] }>("/v1/models?configuredOnly=true&prefix=canonical")
      .then(result => setCatalog(result.data.filter(row => row.owned_by !== "combo")))
      .catch(error => setError(String(error)));
  }, []);
  async function load() {
    setLoading(true); setError(""); setModel(null);
    try {
      const result = await api.get<{ model: ModelMetadata }>(`/api/model-metadata?${new URLSearchParams({ provider, modelId })}`);
      setModel(result.model);
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setLoading(false); }
  }
  return <section className="page">
    <h1>Model capabilities</h1>
    <p>This editor requires direct localhost access (or an SSH tunnel). Remote and reverse-proxy editing is disabled until dashboard authentication is integrated.</p>
    <form className="model-editor card" onSubmit={event => { event.preventDefault(); void load(); }}>
      <label>Configured model
        <select defaultValue="" onChange={event => {
          const row = catalog.find(row => row.id === event.target.value);
          if (!row) return;
          setProvider(row.owned_by);
          setModelId(row.id.includes("/") ? row.id.slice(row.id.indexOf("/") + 1) : row.id);
          setModel(null);
        }}>
          <option value="" disabled>Select a model</option>
          {catalog.map(row => <option key={row.id} value={row.id}>{row.id}</option>)}
        </select>
      </label>
      <label>Provider<input required value={provider} onChange={event => { setProvider(event.target.value); setModel(null); }} /></label>
      <label>Model ID<input required value={modelId} onChange={event => { setModelId(event.target.value); setModel(null); }} /></label>
      <button type="submit" disabled={loading}>{loading ? "Loading…" : "Load metadata"}</button>
    </form>
    {error && <p role="alert" className="bad">{error}</p>}
    {model && <ModelEditor key={`${model.provider}/${model.modelId}`} model={model} onSaved={setModel} />}
  </section>;
}

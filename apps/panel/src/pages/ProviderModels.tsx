import { useState } from "react";
import { api } from "../lib/api.ts";
import { useFetch } from "../lib/useFetch.ts";
import { useTranslator } from "../lib/useTranslator.ts";
import { Modal } from "../lib/actions.tsx";
import { ModelEditor } from "./Models.tsx";

interface Row { manualOverlay?: Record<string, unknown> | null; id: string; name?: string; modelName?: string; origin: string; apiFormat?: string; type?: string; context_length?: number | null; inputTokenLimit?: number | null; outputTokenLimit?: number | null; supportsVision?: boolean | null; capabilities?: { vision?: boolean; tool_calling?: boolean; thinking?: boolean; reasoning?: boolean } }
type Metadata = Parameters<typeof ModelEditor>[0]["model"];
export function ProviderModels({ providerId }: { providerId: string }) {
  const tr = useTranslator();
  const path = `/api/providers/${encodeURIComponent(providerId)}/models`;
  const models = useFetch<{ prefix: string; models: Row[] }>(path);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Row | "new" | null>(null);
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [inputLimit, setInputLimit] = useState("");
  const [outputLimit, setOutputLimit] = useState("");
  const [vision, setVision] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const [probe, setProbe] = useState<Row | null>(null);

  const [probeResult, setProbeResult] = useState("");
  const [testing, setTesting] = useState(false);
  async function runProbe(e: React.FormEvent) {
    e.preventDefault();
    if (!probe || models.status !== "ok" || !models.data.prefix || testing) return;
    setTesting(true); setProbeResult("");
    try {
      const response = await fetch("/api/model-test", { method: "POST", redirect: "error", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: `${models.data.prefix}/${probe.id}` }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        // Do not display upstream error text: providers can echo credentials or other secrets.
        const reason = response.status === 401 ? tr("Authentication required") : response.status === 403 ? tr("Access denied") : response.status === 429 ? tr("Quota exhausted or rate limited") : "";
        setProbeResult(`${tr("Test failed")} (HTTP ${response.status})${reason ? `: ${reason}` : ""}`);
      } else if (payload?.ok === true) {
        setProbeResult(tr("Test succeeded"));
      } else {
        setProbeResult(tr("Test failed: invalid completion response"));
      }
    } catch { setProbeResult(tr("Test failed")); }
    finally { setTesting(false); }
  }
  function edit(row: Row | "new") { setEditing(row); setId(row === "new" ? "" : row.id); setName(row === "new" ? "" : row.name ?? row.modelName ?? row.id); setInputLimit(row === "new" || row.inputTokenLimit == null ? "" : String(row.inputTokenLimit)); setOutputLimit(row === "new" || row.outputTokenLimit == null ? "" : String(row.outputTokenLimit)); setVision(row === "new" || row.supportsVision == null ? "" : String(row.supportsVision)); setError(""); }
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!editing || busy) return;
    const limits = [inputLimit, outputLimit];
    if (limits.some(value => value && (!Number.isSafeInteger(Number(value)) || Number(value) <= 0))) { setError(tr("Token limits must be positive whole numbers")); return; }
    const capabilities = { inputTokenLimit: inputLimit ? Number(inputLimit) : null, outputTokenLimit: outputLimit ? Number(outputLimit) : null, supportsVision: vision === "" ? null : vision === "true" };
    setBusy(true); setError("");
    try { if (editing === "new") await api.post(path,{id:id.trim(), ...(name.trim() ? {name:name.trim()} : {}), ...Object.fromEntries(Object.entries(capabilities).filter(([, value]) => value !== null))});
      else {
        const changed = capabilities.inputTokenLimit !== (editing.inputTokenLimit ?? null) || capabilities.outputTokenLimit !== (editing.outputTokenLimit ?? null) || capabilities.supportsVision !== (editing.supportsVision ?? null);
        await api.patch(`${path}/${encodeURIComponent(editing.id)}`,{name:name.trim(), ...(changed ? capabilities : {})});
      }
      setEditing(null); models.reload();
    } catch (e) { setError(e instanceof Error ? e.message : tr("Could not save model")); } finally { setBusy(false); }
  }
  async function remove(row: Row) {
    if (busy || !window.confirm(tr("Delete manual model {0}?", {0:row.id}))) return;
    setBusy(true); setError("");
    try { await api.delete(`${path}/${encodeURIComponent(row.id)}`); models.reload(); }
    catch (e) { setError(e instanceof Error ? e.message : tr("Could not delete model")); } finally { setBusy(false); }
  }
  async function configure(row: Row) {
    setBusy(true); setError("");
    try { const result = await api.get<{model:Metadata}>(`/api/model-metadata?${new URLSearchParams({provider:providerId,modelId:row.id})}`); setMetadata(result.model); }
    catch { setError(tr("Could not load model configuration")); } finally { setBusy(false); }
  }
  return <section className="card provider-models" style={{marginTop:16}}><div className="section-head"><h2>{tr("Models")}</h2><button type="button" className="btn-add" onClick={()=>edit("new")}>{tr("Add model")}</button></div>
    <p className="muted">{tr("Saving a model does not verify upstream availability.")}</p>
    <label>{tr("Search models")}<input type="search" value={search} onChange={e=>setSearch(e.target.value)} /></label>
    {error && <p role="alert" className="bad">{error}</p>}
    {models.status === "loading" && <p role="status">{tr("Loading models")}</p>}
    {models.status === "error" && <p role="alert">{tr("Could not load models")} <button type="button" className="btn-ghost" onClick={models.reload}>{tr("Retry")}</button></p>}
    {models.status === "ok" && <ul className="provider-model-list">{models.data.models.filter(row=>`${row.id} ${row.name ?? row.modelName ?? ""}`.toLowerCase().includes(search.toLowerCase())).map(row=><li key={row.id} data-model-id={row.id}><div><strong>{row.name ?? row.modelName ?? row.id}</strong> <code>{row.id}</code> <span>{tr(row.origin)}</span>{row.apiFormat && <span> · {row.apiFormat}</span>}{row.type && <span> · {row.type}</span>}{row.context_length != null && <span> · {row.context_length.toLocaleString()}</span>}{row.capabilities?.vision && <span> · {tr("Vision")}</span>}{row.capabilities?.tool_calling && <span> · {tr("Tools")}</span>}{(row.capabilities?.thinking || row.capabilities?.reasoning) && <span> · {tr("Reasoning")}</span>}{row.manualOverlay && <p className="muted">{tr("A legacy manual record also exists for this model. It may affect catalog metadata; this row cannot be edited or deleted here.")}</p>}</div><div className="row-actions"><button type="button" className="btn-ghost" disabled={busy} onClick={()=>configure(row)}>{tr("Configure")}</button>{(!row.type || row.type === "chat") && models.data.prefix && <button type="button" className="btn-ghost" onClick={()=>{setProbe(row);setProbeResult("");}}>{tr("Test model")}</button>}{row.origin === "manual" && <><button type="button" className="btn-ghost" disabled={busy} onClick={()=>edit(row)}>{tr("Edit")}</button><button type="button" className="btn-danger" disabled={busy} onClick={()=>remove(row)}>{tr("Delete")}</button></>}</div></li>)}</ul>}
    <Modal open={editing !== null} onOpenChange={open=>{if(!open&&!busy)setEditing(null);}} title={tr(editing === "new" ? "Add model" : "Edit model")}>
      <form className="stack-form" onSubmit={save}><label>{tr("Model ID")}<input value={id} onChange={e=>setId(e.target.value)} disabled={editing !== "new" || busy} required maxLength={200} /></label><label>{tr("Display name")}<input value={name} onChange={e=>setName(e.target.value)} required={editing !== "new"} maxLength={200} /></label><label>{tr("Input token limit")}<input type="number" min="1" step="1" value={inputLimit} onChange={e=>setInputLimit(e.target.value)} disabled={busy} /></label><label>{tr("Output token limit")}<input type="number" min="1" step="1" value={outputLimit} onChange={e=>setOutputLimit(e.target.value)} disabled={busy} /></label><label>{tr("Vision support")}<select value={vision} onChange={e=>setVision(e.target.value)} disabled={busy}><option value="">{tr("Default")}</option><option value="true">{tr("Yes")}</option><option value="false">{tr("No")}</option></select></label>{error && <p role="alert">{error}</p>}<button className="btn-add" disabled={busy}>{tr("Save model")}</button></form>
    </Modal>
    <Modal open={metadata !== null} onOpenChange={open=>{if(!open)setMetadata(null);}} title={tr("Configure model")}>
      {metadata && <ModelEditor model={metadata} onSaved={()=>models.reload()} onClose={()=>setMetadata(null)} />}
    </Modal>
    <Modal open={probe !== null} onOpenChange={open=>{if(!open && !testing){setProbe(null);setProbeResult("");}}} title={tr("Test model")}>
      {probe && models.status === "ok" && <form className="stack-form" onSubmit={runProbe}><p><code>{models.data.prefix}/{probe.id}</code></p><p>{tr("This sends a real request and may incur usage charges.")}</p><button className="btn-add" disabled={testing}>{tr("Run test")}</button>{probeResult && <p role="status">{probeResult}</p>}</form>}
    </Modal>
  </section>;
}

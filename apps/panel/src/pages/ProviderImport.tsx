import { useRef, useState } from "react";
import { api, type JsonValue } from "../lib/api.ts";
import {ReadFreshness} from "../components/OperationalUI";
import { useFetch } from "../lib/useFetch.ts";
import { useTranslator } from "../lib/useTranslator.ts";

type Contract = {id:string; supported:boolean; access:boolean; accessRefresh:boolean; json:boolean; reason:string|null; refreshReason:string|null};
type Result = {index:number;valid:boolean;provider?:string;providerSource?:string;mode?:string;expiresAt?:string|null;refreshable?:boolean;id?:string;error?:string};
const safeErrors = new Set(["Import conflicts with existing credentials; existing account was not changed", "Entry must be an object", "Too many nested wrappers", "Unknown provider", "Conflicting providers", "Unknown provider host", "Conflicting provider hosts", "Conflicting provider and host", "Ambiguous provider host", "A valid access token is required", "Ambiguous access tokens", "Invalid refresh token", "Ambiguous token pair", "Invalid expiry", "Ambiguous Codex workspace binding", "Invalid Codex workspace identifier", "Conflicting Codex workspace identifiers", "Could not securely save account; check encryption configuration", "Web session or cookie credentials require a provider-specific import flow", "GitHub Copilot requires a separate Copilot token exchange", "Antigravity may require Google project configuration not imported here", "Kiro refresh and account configuration depend on the authentication method", "Credential contract has not been verified for generic token import", "Refresh import requires a reviewed provider-specific secure refresh path", "API-key credentials do not accept OAuth refresh tokens"]);
export function ProviderImport({providerId,onSaved}:{providerId:string;onSaved:()=>void}) {
  const tr=useTranslator();
  const contracts=useFetch<{providers:Contract[]}>("/api/connections/import/providers");
  const [provider,setProvider]=useState(providerId);
  const [mode,setMode]=useState<"access"|"pair"|"json">("access");
  const [phase,setPhase]=useState<"input"|"preview"|"result">("input");
  const [results,setResults]=useState<Result[]>([]);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const access=useRef<HTMLInputElement>(null),refresh=useRef<HTMLInputElement>(null),text=useRef<HTMLTextAreaElement>(null),file=useRef<HTMLInputElement>(null);
  // A random in-memory HMAC key binds resubmission to the preview without retaining raw credentials.
  const key=useRef<CryptoKey | null>(null), digest=useRef<string | null>(null);
  const contract=contracts.status==="ok" ? contracts.data.providers.find(c=>c.id===provider) : undefined;
  const allowed=!!contract && (mode==="json" ? contract.json : mode==="pair" ? contract.accessRefresh : contract.access);
  const formatAllowed=mode==="json" ? !!contract && contracts.status==="ok" && contracts.data.providers.some(c=>c.json) : allowed;
  function clear() { if(access.current)access.current.value=""; if(refresh.current)refresh.current.value=""; if(text.current)text.current.value=""; if(file.current)file.current.value=""; }
  function reset() { clear(); key.current=null;digest.current=null;setPhase("input");setResults([]);setError(""); }
  async function submit(e:React.FormEvent) {
    e.preventDefault(); if(busy || !formatAllowed)return;
    setBusy(true);setError("");
    try {
      let accounts:JsonValue;
      if(mode==="json") {
        const upload=file.current?.files?.[0];
        if(upload && upload.size>900000) throw new Error();
        const raw=upload ? await upload.text() : text.current?.value ?? "";
        accounts=JSON.parse(raw) as JsonValue;
      } else accounts={access_token:access.current?.value ?? "",...(mode==="pair" ? {refresh_token:refresh.current?.value ?? ""} : {})};
      clear();
      if (!key.current) key.current=await crypto.subtle.generateKey({name:"HMAC",hash:"SHA-256"},false,["sign"]);
      const signed=await crypto.subtle.sign("HMAC",key.current,new TextEncoder().encode(JSON.stringify({provider,accounts})));
      const fingerprint=Array.from(new Uint8Array(signed),b=>b.toString(16).padStart(2,"0")).join("");
      if (phase==="result") return;
      if (phase==="preview" && fingerprint!==digest.current) {setError(tr("Input differs from the preview. Cancel and preview again."));return;}
      const result=await api.post<{results:Result[]}>(phase==="preview" ? "/api/connections/import" : "/api/connections/import/preview",{provider,accounts});
      if (phase==="input") digest.current=fingerprint; else {key.current=null;digest.current=null;}
      // Accept only bounded, non-secret fields from the response; never display arbitrary error text.
      const safe=result.results.map((r,i)=>({index:Number.isSafeInteger(r.index)?r.index:i,valid:r.valid===true,error:typeof r.error==="string" && safeErrors.has(r.error)?r.error:undefined,provider:typeof r.provider==="string" && /^[a-zA-Z0-9_-]{1,100}$/.test(r.provider)?r.provider:undefined,providerSource:["explicit","host","fallback"].includes(r.providerSource ?? "")?r.providerSource:undefined,mode:["access","access+refresh"].includes(r.mode ?? "")?r.mode:undefined,expiresAt:typeof r.expiresAt==="string" && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(r.expiresAt)?r.expiresAt:null,refreshable:r.refreshable===true,id:typeof r.id==="string" && /^[a-zA-Z0-9_-]{1,100}$/.test(r.id)?r.id:undefined}));
      if(phase==="preview") {setPhase("result");onSaved();} else setPhase("preview");
      setResults(safe);
    } catch { clear();setError(tr("Import request failed. Check the input and try again.")); } finally {setBusy(false);}
  }
  return <section className="card provider-import" style={{marginTop:16}}><h2>{tr("Import credentials")}</h2><ReadFreshness resource="Import support" state={contracts}/>
    <p className="muted">{tr("Paste JSON, upload a JSON file, or enter access and optional refresh tokens. Preview contains no credentials.")}</p>
    <p className="muted">{tr("The fallback provider is used only when an entry has no provider or host. Preview sends credentials for validation without saving them.")}</p>
    {contracts.status==="loading" && <p role="status">{tr("Loading import support")}</p>}
    {contracts.status==="error" && <p role="alert">{tr("Could not load import support")} <button type="button" onClick={contracts.reload}>{tr("Retry")}</button></p>}
    {contracts.status==="ok" && <><label>{tr("Fallback provider")}<select value={provider} onChange={e=>{reset();setProvider(e.target.value);}}>{!contract && <option value={providerId}>{providerId} — {tr("Unsupported")}</option>}{contracts.data.providers.map(c=><option key={c.id} value={c.id}>{c.id}{c.supported?"":` — ${tr("Unsupported")}`}</option>)}</select></label>
    {!contract?.supported && <p role="status">{tr("Unsupported")}: {contract?.reason && safeErrors.has(contract.reason) ? tr(contract.reason) : contract ? tr("Credential contract has not been verified for generic token import") : tr("Custom providers are not supported by this importer.")}</p>}
    {contract?.supported && <p className="muted">{tr("Access token")}: {contract.access ? tr("Supported") : tr("Unsupported")} · {tr("Access + refresh")}: {contract.accessRefresh ? tr("Supported") : tr("Unsupported")}{contract.accessRefresh && ` — ${tr("Refresh token saved; auto refresh unavailable")}`}</p>}
    <label>{tr("Import format")}<select value={mode} onChange={e=>{reset();setMode(e.target.value as typeof mode);}}><option value="access">{tr("Access token")}</option><option value="pair">{tr("Access + refresh")}</option><option value="json">JSON</option></select></label>
    {!allowed && contract?.supported && <p role="status">{tr("This import format is not supported for this provider.")}</p>}
    {phase==="result" && <button type="button" className="btn-ghost" onClick={reset}>{tr("Start another import")}</button>}
    {phase!=="result" && <form className="stack-form" onSubmit={submit}>
      {phase==="preview" && <p>{tr("Re-enter the same credentials to submit. They were cleared after preview.")}</p>}
      {mode==="json" ? <><label>{tr("JSON paste")}<textarea ref={text} autoComplete="off" rows={6} /></label><label>{tr("Upload JSON")}<input ref={file} type="file" accept="application/json,.json" /></label><p className="muted">{tr("If a file is selected it takes precedence over pasted JSON.")}</p></> : <><label>{tr("Access token")}<input ref={access} type="password" autoComplete="off" required /></label>{mode==="pair" && <label>{tr("Refresh token")}<input ref={refresh} type="password" autoComplete="off" required /></label>}</>}
      <button className="btn-add" disabled={!formatAllowed||busy||(phase==="preview"&&!results.some(r=>r.valid))}>{tr(phase==="preview"?"Import accounts":"Preview import")}</button>{phase==="preview" && <button type="button" className="btn-ghost" onClick={reset}>{tr("Cancel preview")}</button>}
    </form>}
    {error && <p role="alert" className="bad">{error}</p>}
    {results.length>0 && <div aria-live="polite"><h3>{tr(phase==="preview"?"Preview":"Import results")}</h3><ul>{results.map((r,i)=><li key={i}>{tr("Entry")} {r.index+1}: {r.valid ? <>{phase==="result" ? tr("Imported successfully") : tr("Valid")} · {r.provider} · {r.providerSource === "fallback" ? tr("fallback") : r.providerSource} · {r.mode} · {r.refreshable ? tr("Refreshable") : tr("Not refreshable")}{r.expiresAt && ` · ${r.expiresAt}`}</> : tr(r.error ?? "Invalid or could not be saved. Check provider and credentials.")}</li>)}</ul>{phase==="preview" && !results.some(r=>r.valid) && <p>{tr("No valid entries. Cancel preview and correct the input.")}</p>}</div>}
    </>}
  </section>;
}

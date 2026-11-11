import { useState } from 'react';
import { usePreferences } from '../lib/preferences';
import { toast } from 'sonner';
import { Modal } from '../lib/actions.tsx';
import { useFetch } from '../lib/useFetch.ts';
import {ReadFreshness} from './OperationalUI';

type Account = { id: string; provider: string; name: string | null; isActive: boolean };
type Result = { ok?: boolean; status?: string; output?: string; finishReason?: string; usage?: Record<string, number> | null; httpStatus?: number; observedAt?: string; error?: string; model?: string };

export function AccountModelTest({ account, disabled }: { account: Account; disabled: boolean }) {
 const {t,locale}=usePreferences();
 const [open,setOpen]=useState(false);
 const [result,setResult]=useState<Result | null>(null);
 return <>
  <button type="button" className="btn-ghost" disabled={disabled || !account.isActive} onClick={()=>setOpen(true)}>{t("Test Model")}</button>
  {result && <small role="status">{t("Inference")}: {result.status ?? 'failed'} · {result.observedAt ? new Date(result.observedAt).toLocaleString(locale) : ''}</small>}
  <Modal maxWidth="min(520px, calc(100vw - 32px))" open={open} onOpenChange={setOpen} title={t("Test Model — {account}",{account:account.name ?? t("Account")})} description={t("Runs real inference on this exact account. No account or model fallback. This may incur usage charges; credential and catalog checks are separate.")}>
   {open && <AccountModelTestForm account={account} result={result} onResult={setResult} />}
  </Modal>
 </>;
}
function AccountModelTestForm({account,result,onResult}:{account:Account;result:Result|null;onResult:(result:Result)=>void}) {
 const {t,locale}=usePreferences();
 const models=useFetch<{prefix:string;catalogStatus?:string;models:{id:string;name?:string;type?:string}[]}>(`/api/providers/${encodeURIComponent(account.provider)}/models?connectionId=${encodeURIComponent(account.id)}`);
 const [model,setModel]=useState('');
 const [busy,setBusy]=useState(false);
 const canonical = models.status === 'ok' && model ? `${models.data.prefix}/${model}` : '';
 async function run() {
  if (models.status !== 'ok' || models.stale || models.pending || !model || busy) return;
  setBusy(true);
  try {
   const response=await fetch('/api/model-test',{method:'POST',credentials:'same-origin',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:canonical,connectionId: account.id})});
   const data:Result=await response.json();
   const next={...data,model:data.model ?? canonical,httpStatus:data.httpStatus ?? response.status,status:data.status ?? (response.ok ? 'success' : 'failed'),observedAt:data.observedAt ?? new Date().toISOString()};
   onResult(next);
   if (next.ok) toast.success(t("Model inference succeeded")); else toast.error(t("Model inference did not succeed"));
  } catch {onResult({status:'failed',error:t("Request failed"),observedAt:new Date().toISOString()});toast.error(t("Model inference request failed"));}
  finally {setBusy(false);}
 }
 return <div className="stack-form" style={{minWidth:0,overflowWrap:'anywhere'}}>
  <ReadFreshness resource="Provider models" state={models}/><label>{t("Model")}<select style={{minWidth:0,maxWidth:'100%'}} aria-label={t("Model")} value={model} onChange={e=>setModel(e.target.value)} disabled={busy || models.status !== 'ok'}><option value="">{t("Choose a model")}</option>{models.status==='ok' && models.data.models.map(m=><option key={m.id} value={m.id}>{m.name ?? m.id} · {m.id}{m.type ? ` (${m.type})` : ''}</option>)}</select></label>
  {models.status==='ok' && <p>{models.data.catalogStatus === 'known' ? t("Account synced inventory; not proof of entitlement or inference.") : t("Inventory unknown \u2014 provider inventory only, not account entitlement.")}</p>}
  {canonical && <p>{t("Selected")}: <code>{canonical}</code></p>}
  {models.status==='error' && <p role="alert">{t("Model inventory unavailable.")}</p>}
  <button type="button" className="btn-add" disabled={busy || !model || models.stale || models.pending || models.status !== "ok"} onClick={()=>void run()}>{busy?t("Testing\u2026"):t("Run inference")}</button>
  {result && <div role="status"><p>{t("Inference")}: {result.status}</p><p>{t("Model")}: {result.model}</p><p>HTTP: {result.httpStatus ?? '—'}</p><p>{result.error}</p>{result.output && <pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{result.output}</pre>}<p>{t("Finish")}: {result.finishReason ?? '—'}</p><p>{t("Usage")}: {result.usage ? JSON.stringify(result.usage) : 'unknown'}</p><p>{t("Observed")}: {result.observedAt ? new Date(result.observedAt).toLocaleString(locale) : '—'}</p></div>}
 </div>;
}

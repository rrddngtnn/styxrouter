import './confirmation.css';
export function BankedResetCredits({provider,accountId,count,stale,disabled,onReview,tr=(s:string)=>s}:{provider:string;accountId:string;count:number|null;stale:boolean;disabled:boolean;onReview?:()=>void;tr?:(s:string)=>string}) {
 const supported=provider==='codex';
 return <section className="banked-reset-card" aria-label={tr('Banked reset credits')}><h4>{tr('Banked reset credits')}</h4><small>{provider} · <code>{accountId}</code></small>
 <p>{supported?<><strong>{count===null?tr('Unknown'):count}</strong> · {tr(stale?'Stale':'Cached')}</>:tr('Unsupported')}</p>
 <p className="muted">{tr(supported?'Check this account’s inventory before reviewing a credit. No credit is spent automatically.':'No verified reset-credit API is available for this provider.')}</p>
 {supported&&onReview&&<button type="button" className="btn-ghost" disabled={disabled} onClick={onReview}>{tr('Reset credits')}</button>}</section>;
}

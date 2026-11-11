import type {ReactNode, HTMLAttributes} from 'react';
/** Structural card shell preserves the existing page's headings, controls and handlers. */
export function CardFrame({kind,as:Tag='section',className='',children,...props}:HTMLAttributes<HTMLElement>&{kind:CardKind;as?:'section'|'article'|'div';children:ReactNode}) {
 return <Tag {...props} className={`operational-card operational-card-${kind} ${className}`} data-card-family={kind}>{children}</Tag>;
}
import {Check,AlertTriangle,Clock,HelpCircle,XCircle,MinusCircle} from 'lucide-react';
import {usePreferences} from '../lib/preferences';
export function ReadFreshness({state,resource}:{state:{status?:string;stale?:boolean;error?:Error|null;lastSuccessAt?:string|null};resource?:string}) {
 const {t,locale}=usePreferences();
 if(!state.stale && state.status!=='error' && !(resource && state.status==='loading'))return null;
 return <p role={state.status==='loading'?'status':'alert'} className="read-freshness">{resource && <strong>{t(resource)}: </strong>}<strong>{t(state.stale?'Cached data — refresh failed.':state.status==='loading'?'Loading…':'Unable to load data.')}</strong> {state.error?.message} {state.lastSuccessAt && <span>{t('Last successful client fetch')}: <time dateTime={state.lastSuccessAt}>{new Date(state.lastSuccessAt).toLocaleString(locale)}</time></span>}</p>;
}
export type CardKind='provider'|'metric'|'quota'|'attention'|'section';
export function Card({kind,title,description,actions,children}:{kind:CardKind;title:string;description?:string;actions?:ReactNode;children:ReactNode}) {
 return <section className={`operational-card operational-card-${kind}`} data-card-family={kind}><div className="section-head"><div><h2>{title}</h2>{description&&<p className="muted">{description}</p>}</div>{actions&&<div className="row-actions">{actions}</div>}</div>{children}</section>;
}
const statusIcons={unknown:HelpCircle,stale:Clock,error:XCircle,success:Check,warning:AlertTriangle,disabled:MinusCircle};
export function StatusBadge({state,children}:{state:keyof typeof statusIcons;children:ReactNode}) {
 const Icon=statusIcons[state];return <span className="status-badge" data-status={state}><Icon size={14} aria-hidden="true"/>{children}</span>;
}

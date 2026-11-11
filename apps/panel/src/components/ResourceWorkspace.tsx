import {useEffect, useRef, type ReactNode} from 'react';
import {useLocation, useNavigate, useSearchParams} from 'react-router-dom';
import {useMobile} from '../lib/use-mobile';
import {Modal} from '../lib/actions';
import {useTranslator} from '../lib/useTranslator';

/** Only opaque, non-secret resource identifiers enter history. Payloads stay in existing readers. */
export function useResourceInspection<T>(rows: readonly T[], id: (row:T)=>string) {
 const mobile=useMobile();const [params,setParams]=useSearchParams();const location=useLocation();const navigate=useNavigate();
 const inspect=mobile?params.get('inspect'):null;
 const selected=inspect?rows.find(row=>id(row)===inspect)??null:null;
 const open=(row:T)=>{const next=new URLSearchParams(params);next.set('inspect',id(row));setParams(next,{state:{resourceInspect:true}});};
 const close=()=>{if(location.state?.resourceInspect)navigate(-1);else{const next=new URLSearchParams(params);next.delete('inspect');setParams(next,{replace:true});}};
 return {mobile,inspect,selected,open,close};
}

/** Desktop retains its established editor. Mobile mounts the same fields/handlers in page flow. */
export function ResourceInspector({open,onOpenChange,title,description,children,maxWidth}: {open:boolean;onOpenChange:(open:boolean)=>void;title:string;description?:string;children:ReactNode;maxWidth?:string}) {
 const mobile=useMobile();const tr=useTranslator();const heading=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{if(open&&mobile){window.scrollTo(0,0);heading.current?.focus({preventScroll:true});}},[open,mobile]);
 if(!mobile)return <Modal open={open} onOpenChange={onOpenChange} title={title} description={description} maxWidth={maxWidth}>{children}</Modal>;
 if(!open)return null;
 return <section className="resource-inspector" data-resource-inspector="active"><button type="button" className="btn-ghost" onClick={()=>onOpenChange(false)}>← {tr('Back')}</button><h2 ref={heading} tabIndex={-1}>{title}</h2>{description&&<p className="muted">{description}</p>}{children}</section>;
}

export function ResourceRows({label,children}:{label:string;children:ReactNode}) {
 return <ul className="resource-rows" aria-label={label}>{children}</ul>;
}
export function ResourceRow({title,summary,onOpen,children}:{title:ReactNode;summary:ReactNode;onOpen:()=>void;children?:ReactNode}) {
 return <li><div><button type="button" className="account-resource-name" onClick={onOpen}>{title}</button><div className="resource-summary">{summary}</div>{children}</div></li>;
}

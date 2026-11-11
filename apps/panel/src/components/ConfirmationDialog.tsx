import {useEffect,useRef,useState} from 'react';
import {Dialog} from '@radix-ui/themes';
import {usePreferences} from '../lib/preferences';
import './confirmation.css';
export type ConfirmationRequest=Readonly<{title:string;description:string;resource:string;action:string;danger?:boolean}>;
/** A single immutable review lease. Callers must revalidate their inventory after acceptance. */
export function useConfirmation(){
 const [request,setRequest]=useState<ConfirmationRequest|null>(null);
 const resolver=useRef<((accepted:boolean)=>void)|null>(null);
 const settle=(accepted:boolean)=>{const resolve=resolver.current;resolver.current=null;setRequest(null);resolve?.(accepted);};
 useEffect(()=>()=>{resolver.current?.(false);resolver.current=null;},[]);
 return {confirm:(value:ConfirmationRequest)=>{if(resolver.current)return Promise.resolve(false);return new Promise<boolean>(resolve=>{resolver.current=resolve;setRequest(Object.freeze({...value}));});},dialog:<ConfirmationDialog request={request} onDecision={settle}/>};
}
export function ConfirmationDialog({request,onDecision}:{request:ConfirmationRequest|null;onDecision:(accepted:boolean)=>void}){
 const {language}=usePreferences();const cancel=useRef<HTMLButtonElement>(null);const opener=useRef<HTMLElement|null>(null);const locked=useRef(false);
 const choose=(value:boolean)=>{if(locked.current)return;locked.current=true;onDecision(value);};
 return <Dialog.Root open={!!request} onOpenChange={open=>{if(!open)choose(false);}}><Dialog.Content className="styx-confirmation" onOpenAutoFocus={event=>{event.preventDefault();locked.current=false;opener.current=document.activeElement instanceof HTMLElement?document.activeElement:null;cancel.current?.focus();}} onCloseAutoFocus={event=>{event.preventDefault();if(opener.current?.isConnected)opener.current.focus();}}>
 <Dialog.Title>{request?.title}</Dialog.Title><Dialog.Description>{request?.description}</Dialog.Description>
 <div className="styx-confirmation-resource"><code>{request?.resource}</code></div>
 <footer><button ref={cancel} type="button" className="btn-ghost" onClick={()=>choose(false)}>{language==='id'?'Batal':'Cancel'}</button><button type="button" className={request?.danger?'btn-danger':'btn-add'} onClick={()=>choose(true)}>{request?.action}</button></footer>
 </Dialog.Content></Dialog.Root>;
}

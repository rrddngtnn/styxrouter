import {useState,type ReactNode} from 'react';
import {Dialog} from '@radix-ui/themes';
import {usePreferences} from '../lib/preferences';
import './progressive-filters.css';
export function useFilterLabels(){const {language}=usePreferences();return language==='id'?{filters:'Filter',apply:'Terapkan filter',cancel:'Batal',clear:'Hapus semua',missing:'Resource tidak ditemukan dalam data yang dimuat.',loading:'Memuat detail…',example:'Contoh',scope:'Filter hanya berlaku pada data yang dimuat.',discard:'Buang perubahan yang belum disimpan?'}:{filters:'Filters',apply:'Apply filters',cancel:'Cancel',clear:'Clear all',missing:'Resource not found in loaded data.',loading:'Loading details…',example:'Example',scope:'Filters apply to loaded data only.',discard:'Discard unsaved changes?'};}
export function ProgressiveFilters<T extends Record<string,string>>({value,defaults,onApply,children}:{value:T;defaults:T;onApply:(value:T)=>void;children:(draft:T,setDraft:(value:T)=>void)=>ReactNode}){
 const labels=useFilterLabels();const [open,setOpen]=useState(false);const [draft,setDraft]=useState(value);
 const count=Object.keys(defaults).filter(key=>value[key]!==defaults[key]).length;
 return <Dialog.Root open={open} onOpenChange={next=>{if(next)setDraft({...value});setOpen(next);}}><Dialog.Trigger><button type="button" className="btn-ghost">{labels.filters}{count?` (${count})`:''}</button></Dialog.Trigger><Dialog.Content className="progressive-filter-sheet"><Dialog.Title>{labels.filters}</Dialog.Title><Dialog.Description>{labels.scope}</Dialog.Description><div className="progressive-filter-fields">{children(draft,setDraft)}</div><footer><button type="button" className="btn-ghost" onClick={()=>setDraft({...defaults})}>{labels.clear}</button><button type="button" className="btn-ghost" onClick={()=>setOpen(false)}>{labels.cancel}</button><button type="button" className="btn-add" onClick={()=>{onApply(draft);setOpen(false);}}>{labels.apply}</button></footer></Dialog.Content></Dialog.Root>;
}
export function InspectionFallback({loading=false}:{loading?:boolean}){const labels=useFilterLabels();return <p role="status">{loading?labels.loading:labels.missing}</p>;}

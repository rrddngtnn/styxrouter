import {useId,useState, type ReactNode} from 'react';
import type {QuotaWindow} from '../lib/types';
import {usePreferences} from '../lib/preferences';

/** Presentation only. Existing QuotaBrowser owns merging, freshness and checks. */
export function QuotaWindowInspector({windows,renderWindow}:{windows:QuotaWindow[];renderWindow:(window:QuotaWindow)=>ReactNode}) {
 const {language}=usePreferences();const id=useId();const [selected,setSelected]=useState(windows[0]?.key ?? '');const [details,setDetails]=useState(false);
 const w=windows.find(w=>w.key===selected) ?? windows[0];if(!w)return null;
 const text=(en:string,id:string)=>language==='id'?id:en;
 return <div className="quota-window-inspector">
  <label className="quota-window-select" htmlFor={id}>{text('Quota window','Jendela kuota')}<select id={id} aria-label={text('Quota window','Jendela kuota')} value={w.key} onChange={e=>setSelected(e.target.value)}>{windows.map(w=><option key={w.key} value={w.key}>{w.label}</option>)}</select></label>
  {renderWindow(w)}
  <button type="button" className="btn-ghost" aria-expanded={details} aria-controls={`${id}-detail`} onClick={()=>setDetails(v=>!v)}>{text('Window details','Detail jendela')}</button>
  {details && <dl id={`${id}-detail`} className="quota-exact-values">
   <dt>{text('Remaining (exact normalized value)','Sisa (nilai normalisasi tepat)')}</dt><dd>{w.remaining ?? text('Not reported','Tidak dilaporkan')}</dd>
   <dt>{text('Used (exact normalized value)','Terpakai (nilai normalisasi tepat)')}</dt><dd>{w.used ?? text('Not reported','Tidak dilaporkan')}</dd>
   <dt>{text('Limit (exact normalized value)','Batas (nilai normalisasi tepat)')}</dt><dd>{w.total ?? text('Not reported','Tidak dilaporkan')}</dd>
   <dt>{text('Remaining percent (before display clamp)','Persen sisa (sebelum pembatasan tampilan)')}</dt><dd>{w.percentRemaining ?? text('Not reported','Tidak dilaporkan')}</dd>
   <dt>{text('Units / window duration','Satuan / durasi jendela')}</dt><dd>{text('Provider-specific units; duration is not inferred from opaque keys. No common request or token unit is guaranteed.','Satuan khusus penyedia; durasi tidak disimpulkan dari kunci yang tidak jelas. Tidak ada jaminan satuan permintaan atau token yang sama.')}</dd>
   <dt>{text('Normalized window key','Kunci jendela yang dinormalisasi')}</dt><dd><code>{w.key}</code></dd>
   <dt>{text('Reset timestamp (upstream)','Waktu reset (upstream)')}</dt><dd>{w.resetAt ?? text('Not reported','Tidak dilaporkan')}</dd>
   <dt>{text('Models','Model')}</dt><dd>{w.models?.join(', ') || text('Not reported','Tidak dilaporkan')}</dd>
  </dl>}
  <details className="quota-more"><summary>{text('More quota windows','Jendela kuota lainnya')} ({Math.max(0,windows.length-1)})</summary>{windows.filter(window => window.key !== w.key).map(renderWindow)}</details>
 </div>;
}

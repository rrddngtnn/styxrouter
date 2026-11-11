import {useConfirmation} from './ConfirmationDialog';
import {useRef,useState} from 'react';
import {usePreferences} from '../lib/preferences';

export function useToolsCopy() {
 const {language}=usePreferences();
 return (en:string,id:string)=>language==='id'?id:en;
}
export function ToolSnippet({title,file,body,secretBody}:{title:string;file:string;body:string;secretBody?:string}) {
 const t=useToolsCopy();const [status,setStatus]=useState('');const confirmation=useConfirmation();const copyLock=useRef(false);const current=useRef({body,secretBody});if(current.current.body!==body||current.current.secretBody!==secretBody)current.current={body,secretBody};
 async function copy(secret=false){
  if(copyLock.current)return;copyLock.current=true;const snapshot=current.current;
  if(secret&&(!await confirmation.confirm({title:t('Copy with key?','Salin dengan kunci?'),description:t('This puts a secret on your clipboard. Only paste into a trusted client.','Rahasia akan masuk ke papan klip. Tempel hanya ke klien tepercaya.'),resource:`${title} / ${file}`,action:t('Copy with key','Salin dengan kunci'),danger:true})||snapshot!==current.current)){copyLock.current=false;return;}
  try {if(!navigator.clipboard)throw new Error();await navigator.clipboard.writeText(secret?snapshot.secretBody!:snapshot.body);setStatus(t('Copied','Tersalin'));}
  catch {setStatus(t('Clipboard unavailable. Select and copy the placeholder example manually.','Papan klip tidak tersedia. Pilih dan salin contoh placeholder secara manual.'));}
  finally{copyLock.current=false;}
 }
 return <section className="tools-snippet-card">{confirmation.dialog}<header className="tools-snippet-head"><div className="tools-snippet-meta"><strong>{title}</strong><code>{file}</code></div><div className="row-actions"><button type="button" className="btn-ghost" onClick={()=>void copy()}>{t('Copy snippet','Salin cuplikan')}</button>{secretBody!==undefined&&<button type="button" className="btn-ghost" disabled={!secretBody} onClick={()=>void copy(true)}>{t('Copy with key','Salin dengan kunci')}</button>}</div></header><pre className="tools-snippet-body" tabIndex={0}>{body}</pre><p role="status" className="tools-copy-status">{status}</p></section>;
}
export const API_PATHS=[
 {path:'chat/completions',method:'POST',protocol:'OpenAI Chat Completions',auth:'Authorization: Bearer YOUR_STYX_KEY',payload:{model:'provider/model-id',messages:[{role:'user',content:'Hello'}],max_tokens:16}},
 {path:'messages',method:'POST',protocol:'Anthropic Messages',auth:'x-api-key: YOUR_STYX_KEY; anthropic-version: 2023-06-01',payload:{model:'provider/model-id',messages:[{role:'user',content:'Hello'}],max_tokens:16}},
 {path:'responses',method:'POST',protocol:'OpenAI Responses',auth:'Authorization: Bearer YOUR_STYX_KEY',payload:{model:'provider/model-id',input:'Hello'}},
 {path:'models',method:'GET',protocol:'Model catalog',auth:'Authorization: Bearer YOUR_STYX_KEY',payload:null},
 {path:'embeddings',method:'POST',protocol:'OpenAI Embeddings',auth:'Authorization: Bearer YOUR_STYX_KEY',payload:{model:'provider/embedding-model-id',input:'Hello'}},
];
export function ToolsApiReference(){const t=useToolsCopy();const [search,setSearch]=useState('');const found=API_PATHS.filter(p=>(p.path+p.protocol+p.auth).toLowerCase().includes(search.toLowerCase()));
 return <section className="tools-reference"><label className="tools-field">{t('Search API reference','Cari referensi API')}<input type="search" value={search} onChange={e=>setSearch(e.target.value)}/></label><p className="muted">{t('Reference only. Examples do not run; support and model availability depend on the configured provider.','Hanya referensi. Contoh tidak dijalankan; dukungan dan ketersediaan model bergantung pada penyedia.')}</p>{found.length===0&&<p role="status">{t('No matching endpoints','Tidak ada endpoint yang cocok')}</p>}{found.map(p=><details key={p.path}><summary><code>{p.method} /v1/{p.path}</code><span>{p.protocol}</span></summary><p><strong>{t('Auth header','Header autentikasi')}: </strong><code>{p.auth}</code></p><ToolSnippet title={t('Minimal request · inert example','Permintaan minimal · contoh tidak aktif')} file="HTTP" body={`${p.method} /v1/${p.path}\n${p.auth}\n${p.payload?'Content-Type: application/json\n\n'+JSON.stringify(p.payload,null,2):''}`}/></details>)}</section>;
}

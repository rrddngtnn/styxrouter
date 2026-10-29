import { useMemo, useState } from 'react';
import { Copy, Download, Database, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Modal } from '../../lib/actions.tsx';
import { api } from '../../lib/api.ts';
import { usePreferences } from '../../lib/preferences.tsx';
import { LoadingState } from '../PageStates.tsx';
import { TableScroll } from '../TableScroll.tsx';
import { filterSettings, sanitizeSettings, isMigrationLoopback, parseMigrationResult, type MigrationResult } from './advanced-settings-helpers.ts';
import './advanced-settings.css';

export function AdvancedSettings({settings,loading=false,error}: {settings:Record<string,unknown>;loading?:boolean;error?:string}) {
  const {t} = usePreferences();
  const [query,setQuery]=useState(''); const [jsonView,setJsonView]=useState(false);
  const sanitized=useMemo(()=>sanitizeSettings(settings),[settings]);
  const shown=useMemo(()=>filterSettings(sanitized,query),[sanitized,query]);
  const json=JSON.stringify(shown,null,2);
  async function copy(){ try {await navigator.clipboard.writeText(json);toast.success(t('Copied JSON'));}catch{toast.error(t('Clipboard unavailable'));} }
  function download(){const url=URL.createObjectURL(new Blob([json],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='styx-settings-redacted.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  return <div className="advanced-settings">
    <section className="settings-card">
      <div className="section-head"><div><h2>{t('Configuration inspector')}</h2><p className="muted">{t('Read-only configuration. Sensitive values are redacted before display and export.')}</p></div><div className="row-actions"><button className="btn-ghost" disabled={loading||Boolean(error)} onClick={copy}><Copy size={16}/>{t('Copy JSON')}</button><button className="btn-ghost" disabled={loading||Boolean(error)} onClick={download}><Download size={16}/>{t('Download JSON')}</button></div></div>
      <div className="toolbar"><label className="advanced-search"><Search size={16}/><input type="search" aria-label={t('Search setting keys')} placeholder={t('Search setting keys')} value={query} onChange={e=>setQuery(e.target.value)}/></label><button className="btn-ghost" aria-pressed={jsonView} onClick={()=>setJsonView(!jsonView)}>{t(jsonView?'Table view':'JSON view')}</button></div>
      {loading ? <LoadingState label={t('Loading configuration')}/> : error ? <p role="alert" className="bad">{error}</p> : jsonView ? <pre className="json">{json}</pre> : <div className="advanced-table-wrap"><TableScroll label={t('Configuration table')} stickyPrimary><table className="table"><thead><tr><th>{t('Setting')}</th><th>{t('Value')}</th></tr></thead><tbody>{Object.entries(shown).map(([key,value])=><tr key={key}><td><code>{key}</code></td><td>{typeof value==='object'&&value!==null?<details><summary>{Array.isArray(value)?`${value.length} ${t('items')}`:t('Object')}</summary><pre className="json">{JSON.stringify(value,null,2)}</pre></details>:<code>{String(value)}</code>}</td></tr>)}</tbody></table></TableScroll>{Object.keys(shown).length===0&&<p className="muted">{t('No matching settings')}</p>}</div>}
    </section>
    <LocalMigration />
  </div>;
}
function LocalMigration(){
  const {t}=usePreferences();const local=typeof location!=='undefined'&&isMigrationLoopback(location.hostname);
  const [path,setPath]=useState('');const [secret,setSecret]=useState('');const [dry,setDry]=useState(true);const [confirm,setConfirm]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [result,setResult]=useState<MigrationResult|null>(null);
  async function run(){if(!local||busy||!path.trim()||!secret)return;setConfirm(false);setBusy(true);setError('');setResult(null);try{const response=await api.post('/api/admin/migrate-from-styx',{srcDb:path.trim(),srcSecret:secret,dryRun:dry});setResult(parseMigrationResult(response,dry));setSecret('');}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
  return <section className="settings-card"><details><summary className="advanced-migration-title"><Database size={18}/>{t('Local database migration')}</summary><p className="muted">{t('Advanced maintenance: rewrites encrypted credential fields in the source database. This does not import accounts into the running router.')}</p>{!local&&<p className="bad">{t('Not available from a remote domain')}. {t('Open the panel through a direct localhost connection. The server also enforces this restriction.')}</p>}
    <div className="stack-form"><label>{t('Source database path')}<input type="text" value={path} placeholder="/path/to/storage.sqlite" disabled={!local||busy} onChange={e=>setPath(e.target.value)}/></label><label>{t('Source encryption secret')}<input type="password" autoComplete="off" value={secret} disabled={!local||busy} onChange={e=>setSecret(e.target.value)}/></label><label className="check"><input type="checkbox" checked={dry} disabled={!local||busy} onChange={e=>setDry(e.target.checked)}/>{t('Dry run — validate without writing')}</label><div><button className={dry?'btn-ghost':'btn-danger'} disabled={!local||busy||!path.trim()||!secret} onClick={()=>dry?void run():setConfirm(true)}>{busy?t('Processing…'):t(dry?'Validate migration':'Rewrite source database')}</button></div>{error&&<p role="alert" className="bad">{error}</p>}{result&&<div role="status"><h3>{t(result.dryRun?'Validation result':'Migration result')}</h3><dl className="advanced-results"><div><dt>{t('Migrated')}</dt><dd>{result.migrated}</dd></div><div><dt>{t('Failed')}</dt><dd>{result.failed}</dd></div><div><dt>{t('Skipped')}</dt><dd>{result.skipped}</dd></div></dl>{result.backup&&<p>{t('Backup')}: <code>{result.backup}</code></p>}</div>}</div>
    </details><Modal open={confirm} onOpenChange={setConfirm} title={t('Confirm database rewrite')} description={t('The source database will be modified. A backup is created before writing.')}><p><code>{path}</code></p><div className="row-actions"><button className="btn-danger" onClick={()=>void run()}>{t('Rewrite source database')}</button><button className="btn-ghost" onClick={()=>setConfirm(false)}>{t('Cancel')}</button></div></Modal>
  </section>;
}

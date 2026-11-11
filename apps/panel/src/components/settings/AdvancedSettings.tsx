import { useMemo, useState } from 'react';
import { Copy, Download, Database, Lock, Search, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Modal } from '../../lib/actions.tsx';
import { api, type JsonValue } from '../../lib/api.ts';
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
    <nav className="row-actions" aria-label={t('Advanced sections')}>
      <a className="btn-ghost" href="#advanced-inspector">{t('Configuration inspector')}</a>
      <a className="btn-ghost" href="#advanced-bundle">{t('Config bundle')}</a>
      <a className="btn-ghost" href="#advanced-environment">{t('Environment')}</a>
      <a className="btn-ghost" href="#advanced-migration">{t('Local database migration')}</a>
    </nav>
    <section className="settings-card" id="advanced-inspector">
      <div className="section-head"><div><h2>{t('Configuration inspector')}</h2><p className="muted">{t('Read-only configuration. Sensitive values are redacted before display and export.')}</p></div><div className="row-actions"><button className="btn-ghost" disabled={loading||Boolean(error)} onClick={copy}><Copy size={16}/>{t('Copy JSON')}</button><button className="btn-ghost" disabled={loading||Boolean(error)} onClick={download}><Download size={16}/>{t('Download JSON')}</button></div></div>
      <div className="toolbar"><label className="advanced-search"><Search size={16}/><input type="search" aria-label={t('Search setting keys')} placeholder={t('Search setting keys')} value={query} onChange={e=>setQuery(e.target.value)}/></label><button className="btn-ghost" aria-pressed={jsonView} onClick={()=>setJsonView(!jsonView)}>{t(jsonView?'Table view':'JSON view')}</button></div>
      {loading ? <LoadingState label={t('Loading configuration')}/> : error ? <p role="alert" className="bad">{error}</p> : jsonView ? <pre className="json">{json}</pre> : <div className="advanced-table-wrap"><TableScroll label={t('Configuration table')} stickyPrimary><table className="table"><thead><tr><th>{t('Setting')}</th><th>{t('Value')}</th></tr></thead><tbody>{Object.entries(shown).map(([key,value])=><tr key={key}><td><code>{key}</code></td><td>{typeof value==='object'&&value!==null?<details><summary>{Array.isArray(value)?`${value.length} ${t('items')}`:t('Object')}</summary><pre className="json">{JSON.stringify(value,null,2)}</pre></details>:<code>{String(value)}</code>}</td></tr>)}</tbody></table></TableScroll>{Object.keys(shown).length===0&&<p className="muted">{t('No matching settings')}</p>}</div>}
    </section>
    <div id="advanced-bundle"><EncryptedConfigBundleSection /></div>
    <div id="advanced-environment"><EnvironmentEditorSection /></div>
    <div id="advanced-migration"><LocalMigration /></div>
  </div>;
}

export function EnvironmentEditorSection() {
  const {t} = usePreferences();
  const [keyName, setKeyName] = useState('STYX_ANTIGRAVITY_CLIENT_PROFILE');
  const [keyValue, setKeyValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [savedMsg, setSavedMsg] = useState('');

  async function saveEnvKey(e: React.FormEvent) {
    e.preventDefault();
    if (!keyName.trim()) return;
    setBusy(true); setErr(''); setSavedMsg('');
    try {
      const res = await api.put<{updatedKeys:string[];backupPath:string|null}>('/api/admin/env', {
        updates: { [keyName.trim()]: keyValue.trim() },
      });
      setSavedMsg(`Updated ${res.updatedKeys.join(', ')}${res.backupPath ? ' (backup saved to .env.bak)' : ''}`);
      setKeyValue('');
      toast.success(t('Environment variable saved with .env.bak backup'));
    } catch (error) {
      setErr(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return <section className="settings-card">
    <div className="section-head"><div><h2 className="advanced-migration-title">{t('Environment (.env) syntax-checked editor')}</h2><p className="muted">{t('Update allowlisted non-secret environment variables with quote-balance validation and automatic .env.bak backup before writing.')}</p></div></div>
    <form className="stack-form" onSubmit={saveEnvKey}>
      <div className="two-col" style={{ gap: 12 }}>
        <label>{t('Allowlisted variable')}<select value={keyName} onChange={e=>setKeyName(e.target.value)} disabled={busy}>
          {[
            'STYX_ANTIGRAVITY_CLIENT_PROFILE',
            'STYX_TRUSTED_PUBLIC_ORIGIN',
            'AUTH_COOKIE_SECURE',
            'STYX_BACKUP_KEEP',
            'STYX_BACKUP_MIN_FREE_MB',
            'STYX_BACKUP_INTERVAL_HOURS',
            'STYX_DISABLE_TOKEN_HEALTHCHECK',
            'RATMAN_SOUL_PATH',
            'STREAM_RECOVERY_ENABLED',
            'STREAM_RECOVERY_MIDSTREAM_ENABLED',
            'STREAM_THROUGHPUT_WATCHDOG_ENABLED',
          ].map(k => <option key={k} value={k}>{k}</option>)}
        </select></label>
        <label>{t('Value')}<input type="text" placeholder={t('New value')} value={keyValue} onChange={e=>setKeyValue(e.target.value)} disabled={busy} required/></label>
      </div>
      <div><button type="submit" className="btn-add" disabled={busy||!keyValue.trim()}><span>{busy?'…':t('Validate & write .env')}</span></button></div>
    </form>
    {err && <p role="alert" className="bad">{err}</p>}
    {savedMsg && <p role="status" className="ok">{savedMsg}</p>}
  </section>;
}

export function EncryptedConfigBundleSection() {
  const {t} = usePreferences();
  const [exportPass, setExportPass] = useState('');
  const [importPass, setImportPass] = useState('');
  const [importMode, setImportMode] = useState<'merge'|'replace'>('merge');
  const [bundleText, setBundleText] = useState('');
  const [busy, setBusy] = useState<'export'|'import'|null>(null);
  const [err, setErr] = useState('');
  const [importSummary, setImportSummary] = useState<{settingsUpdated:number;combosImported:number;providerNodesImported:number}|null>(null);

  async function handleExport(e: React.FormEvent) {
    e.preventDefault();
    if (exportPass.trim().length < 12) return;
    setBusy('export'); setErr('');
    try {
      const res = await api.post<{bundle: unknown}>('/api/config-bundle/export', { passphrase: exportPass });
      const text = JSON.stringify(res.bundle, null, 2);
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `styx-config-bundle-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportPass('');
      toast.success(t('Encrypted configuration bundle exported'));
    } catch (error) {
      setErr(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  async function handleImport(e: React.FormEvent) {
    e.preventDefault();
    if (importPass.trim().length < 12 || !bundleText.trim()) return;
    setBusy('import'); setErr(''); setImportSummary(null);
    try {
      let parsed: JsonValue;
      try { parsed = JSON.parse(bundleText) as JsonValue; } catch { throw new Error('Bundle must be valid JSON'); }
      const res = await api.post<{settingsUpdated:number;combosImported:number;providerNodesImported:number}>('/api/config-bundle/import', {
        passphrase: importPass,
        mode: importMode,
        bundle: parsed,
      });
      setImportSummary(res);
      setImportPass('');
      setBundleText('');
      toast.success(t('Configuration bundle imported'));
    } catch (error) {
      setErr(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  return <section className="settings-card">
    <div className="section-head"><div><h2 className="advanced-migration-title"><Lock size={18}/>{t('Encrypted configuration export & import')}</h2><p className="muted">{t('Export routing settings, combos, and custom provider nodes encrypted with a fresh passphrase (AES-256-GCM), or restore a bundle onto another host.')}</p></div></div>
    <div className="two-col" style={{ gap: 16 }}>
      <form className="stack-form" onSubmit={handleExport}>
        <strong>{t('Export encrypted bundle')}</strong>
        <label>{t('Bundle passphrase (12+ characters)')}<input type="password" autoComplete="new-password" placeholder={t('Enter encryption passphrase')} minLength={12} value={exportPass} onChange={e=>setExportPass(e.target.value)} disabled={busy!==null}/></label>
        <div><button type="submit" className="btn-add" disabled={busy!==null||exportPass.trim().length<12}><Download size={14}/><span>{busy==='export'?'…':t('Export encrypted bundle')}</span></button></div>
      </form>
      <form className="stack-form" onSubmit={handleImport}>
        <strong>{t('Import encrypted bundle')}</strong>
        <label>{t('Decryption passphrase')}<input type="password" autoComplete="off" placeholder={t('Enter bundle passphrase')} minLength={12} value={importPass} onChange={e=>setImportPass(e.target.value)} disabled={busy!==null}/></label>
        <label>{t('Import mode')}<select value={importMode} onChange={e=>setImportMode(e.target.value as 'merge'|'replace')} disabled={busy!==null}><option value="merge">{t('Merge with existing combos & settings')}</option><option value="replace">{t('Replace existing combos')}</option></select></label>
        <label>{t('Encrypted bundle JSON file')}<input type="file" accept=".json,application/json" disabled={busy!==null} onChange={async e=>{const file=e.target.files?.[0];if(!file)return;try{setBundleText(await file.text());}catch{setErr('Could not read file');}}}/></label>
        <div><button type="submit" className="btn-ghost" disabled={busy!==null||importPass.trim().length<12||!bundleText.trim()}><Upload size={14}/><span>{busy==='import'?'…':t('Import bundle')}</span></button></div>
      </form>
    </div>
    {err && <p role="alert" className="bad">{err}</p>}
    {importSummary && <p role="status" className="ok">{t('Imported')}: {importSummary.settingsUpdated} settings, {importSummary.combosImported} combos, {importSummary.providerNodesImported} custom nodes.</p>}
  </section>;
}
function LocalMigration(){
  const {t}=usePreferences();const local=typeof location!=='undefined'&&isMigrationLoopback(location.hostname);
  const [path,setPath]=useState('');const [secret,setSecret]=useState('');const [dry,setDry]=useState(true);const [confirm,setConfirm]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [result,setResult]=useState<MigrationResult|null>(null);
  async function run(){if(!local||busy||!path.trim()||!secret)return;setConfirm(false);setBusy(true);setError('');setResult(null);try{const response=await api.post('/api/admin/migrate-from-styx',{srcDb:path.trim(),srcSecret:secret,dryRun:dry});setResult(parseMigrationResult(response,dry));setSecret('');}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
  return <section className="settings-card"><div className="section-head"><div><h2 className="advanced-migration-title"><Database size={18}/>{t('Local database migration')}</h2><p className="muted">{t('Advanced maintenance: rewrites encrypted credential fields in the source database. This does not import accounts into the running router.')}</p></div></div>{!local&&<p className="bad">{t('Not available from a remote domain')}. {t('Open the panel through a direct localhost connection. The server also enforces this restriction.')}</p>}
    <div className="stack-form"><label>{t('Source database path')}<input type="text" value={path} placeholder="/path/to/storage.sqlite" disabled={!local||busy} onChange={e=>setPath(e.target.value)}/></label><label>{t('Source encryption secret')}<input type="password" autoComplete="off" value={secret} disabled={!local||busy} onChange={e=>setSecret(e.target.value)}/></label><label className="check"><input type="checkbox" checked={dry} disabled={!local||busy} onChange={e=>setDry(e.target.checked)}/>{t('Dry run — validate without writing')}</label><div><button className={dry?'btn-ghost':'btn-danger'} disabled={!local||busy||!path.trim()||!secret} onClick={()=>dry?void run():setConfirm(true)}>{busy?t('Processing…'):t(dry?'Validate migration':'Rewrite source database')}</button></div>{error&&<p role="alert" className="bad">{error}</p>}{result&&<div role="status"><h3>{t(result.dryRun?'Validation result':'Migration result')}</h3><dl className="advanced-results"><div><dt>{t('Migrated')}</dt><dd>{result.migrated}</dd></div><div><dt>{t('Failed')}</dt><dd>{result.failed}</dd></div><div><dt>{t('Skipped')}</dt><dd>{result.skipped}</dd></div></dl>{result.backup&&<p>{t('Backup')}: <code>{result.backup}</code></p>}</div>}</div>
    <Modal open={confirm} onOpenChange={setConfirm} title={t('Confirm database rewrite')} description={t('The source database will be modified. A backup is created before writing.')}><p><code>{path}</code></p><div className="row-actions"><button className="btn-danger" onClick={()=>void run()}>{t('Rewrite source database')}</button><button className="btn-ghost" onClick={()=>setConfirm(false)}>{t('Cancel')}</button></div></Modal>
  </section>;
}

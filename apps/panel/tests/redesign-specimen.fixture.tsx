import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import '@radix-ui/themes/styles.css';
import '../src/main.css';
import {PreferencesProvider,usePreferences} from '../src/lib/preferences';
import {Card,StatusBadge} from '../src/components/OperationalUI';
import {LoadingState,EmptyState} from '../src/components/PageStates';
import {Modal,SecretBanner} from '../src/lib/actions';
import {DropdownMenu,Switch,Checkbox,Tooltip} from '@radix-ui/themes';
import {toast} from 'sonner';
function Specimen(){
 const {t}=usePreferences();const [open,setOpen]=useState(false),[selected,setSelected]=useState(false),[secret,setSecret]=useState(false);
 return <main className="content page" style={{margin:'auto'}}><h1>StyxRouter · synthetic component review</h1><p className="muted">Synthetic fixtures only. No server mutations or live inference. Font fallback review; original assets unchanged.</p>
 <div className="two-col">
 <Card kind="provider" title={t('Providers')} description="Original identity, explicit credential state, scoped action"><StatusBadge state="unknown">{t('unchecked')}</StatusBadge><p><code>synthetic-provider/very-long-canonical-identifier-without-hidden-truncation</code></p><a href="#cards" className="btn-ghost">{t('Manage')}</a></Card>
 <Card kind="metric" title={t('Requests')} description="Successful measured zero, not unavailable"><p style={{font:'1.75rem var(--font-mono)'}}>0</p><StatusBadge state="stale">Cached · synthetic observation</StatusBadge></Card>
 <Card kind="quota" title={t('Quota')} description="Unknown limit is not zero"><StatusBadge state="disabled">Unsupported · fixture</StatusBadge><p>Used: — · Limit: — · Reset: —</p><button className="btn-ghost" disabled>{t('Check now')}</button></Card>
 <Card kind="attention" title={t('Account problems')} description="Explicit warning and source"><StatusBadge state="warning">Synthetic quota warning</StatusBadge><p>Cached observation; deliberately check before relying on it.</p><button className="btn-ghost">{t('Reload')}</button></Card>
 </div>
 <Card kind="section" title="Controls and states" description="All eighteen existing component families use the shared grammar">
 <div className="row-actions"><button className="btn-add" data-fixture="primary">{t('Save')}</button><button className="btn-ghost">{t('Cancel')}</button><button className="btn-danger">{t('Delete')}</button><button className="btn-add" disabled>{t('Saving…')}</button></div>
 <form className="stack-form" onSubmit={e=>e.preventDefault()}><label>Search<input type="search" placeholder="Synthetic search"/></label><label>Read-only canonical ID<input readOnly value="fixture/provider/model-with-long-canonical-id"/></label><label>Invalid example<input aria-invalid="true" aria-describedby="fixture-error" defaultValue="bad"/></label><p id="fixture-error" className="bad" role="alert">Synthetic validation error</p><label>Disabled<input disabled value="Unavailable in fixture"/></label><label>Notes<textarea defaultValue="Synthetic draft, never submitted"/></label><label>Native selection<select defaultValue="unknown"><option>unknown</option><option>known</option></select></label>
 <label className="check"><Checkbox checked={selected} onCheckedChange={v=>setSelected(v===true)}/>Selected fixture</label><label className="check"><Checkbox checked="indeterminate"/>Mixed fixture</label><label className="check"><input type="radio" name="fixture-radio" defaultChecked/>Radio choice</label><label className="check"><Switch aria-label="Fixture switch"/>Explicit off/on</label></form>
 <div className="tabs"><button className="tab active" aria-selected="true">Selected</button><button className="tab">Inactive</button><button className="tab" disabled>Disabled</button></div>
 <div className="row-actions"><DropdownMenu.Root><DropdownMenu.Trigger><button className="btn-ghost">Fixture menu</button></DropdownMenu.Trigger><DropdownMenu.Content><DropdownMenu.Item>Available</DropdownMenu.Item><DropdownMenu.Item disabled>Disabled reason</DropdownMenu.Item></DropdownMenu.Content></DropdownMenu.Root><button className="btn-ghost" onClick={()=>setOpen(true)}>Open fixture dialog</button><Tooltip content="Noncritical contextual help"><button className="btn-ghost">Help</button></Tooltip><button className="btn-ghost" onClick={()=>toast.success('Synthetic confirmed outcome')}>Fixture toast</button><button className="btn-ghost" onClick={()=>setSecret(true)}>Intentional synthetic reveal</button></div>
 <div className="table-scroll-region" role="region" aria-label="Synthetic comparison table" tabIndex={0}><table className="table"><caption>Synthetic loaded scope · 2 rows</caption><thead><tr><th>Name</th><th>Observed</th><th>Status</th></tr></thead><tbody><tr><td>Fixture A</td><td>0</td><td><StatusBadge state="success">Credential check passed</StatusBadge></td></tr><tr><td>Fixture B</td><td>—</td><td><StatusBadge state="error">Check failed</StatusBadge></td></tr></tbody></table></div>
 <nav className="pagination" aria-label="Synthetic pagination"><button className="btn-ghost" disabled>Previous</button><button className="btn-ghost pagination-number" aria-current="page">1</button><button className="btn-ghost">Next</button></nav>
 <pre className="json" aria-label="Inert synthetic JSON">{'{"synthetic":true,"secret":"[REDACTED]"}'}</pre>
 <EmptyState title="No matching providers" description="Synthetic no-match, not an unavailable request" action={<button className="btn-ghost">Clear filter</button>}/><LoadingState label="Loading synthetic fixtures" rows={2}/>
 <div className="row-actions">{(['unknown','stale','error','success','warning','disabled'] as const).map(state=><StatusBadge key={state} state={state}>{state}</StatusBadge>)}</div>
 {secret&&<SecretBanner title="Synthetic one-time reveal" secret="SYNTHETIC-NOT-A-CREDENTIAL" onDismiss={()=>setSecret(false)}/>}
 <Modal open={open} onOpenChange={setOpen} title="Synthetic confirmation" description="Only fixture state changes. No network request."><p>Target: fixture A · count: 1</p><div className="row-actions"><button className="btn-ghost" onClick={()=>setOpen(false)}>{t('Cancel')}</button><button className="btn-danger" onClick={()=>setOpen(false)}>Confirm fixture</button></div></Modal>
 </Card></main>;
}
createRoot(document.getElementById('root')!).render(<PreferencesProvider><Specimen/></PreferencesProvider>);

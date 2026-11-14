import { useEffect, useState } from 'react';
import { Link, Navigate, useBeforeUnload, useBlocker, useLocation, useSearchParams } from 'react-router-dom';
import { OutboundProxyConfigSection } from '../components/settings/HealthAndVersionsSettings.tsx';
import { ProviderNetworkRulesPanel } from '../components/settings/RoutingPoliciesPanel.tsx';
import { Modal } from '../lib/actions.tsx';
import { useTranslator } from '../lib/useTranslator.ts';
import { legacyPolicyLocation, policyTab } from '../lib/connection-policy.ts';
import './connection-policy.css';

export function LegacyPolicyRedirect() {
  const location = useLocation();
  const target = legacyPolicyLocation(location.search, location.hash);
  return target ? <Navigate replace to={target} /> : null;
}

export function ConnectionPolicy() {
  const tr = useTranslator();
  const [params] = useSearchParams();
  const tab = policyTab(params.get('tab'));
  const [proxyDirty, setProxyDirty] = useState(false);
  const [rulesDirty, setRulesDirty] = useState(false);
  const dirty = proxyDirty || rulesDirty;
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useBeforeUnload(event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
  useEffect(() => { document.title = `${tr('Connection Policy')} · StyxRouter`; }, [tr]);
  function destination(next: string) {
    const query = new URLSearchParams(params);
    query.set('tab', next);
    return `?${query}`;
  }
  return <div className="page connection-policy-page">
    <h1 tabIndex={-1}>{tr('Connection Policy')}</h1>
    <p className="muted">{tr('Global and provider connection configuration. Provider credentials remain in Providers; client API keys remain in API Keys.')}</p>
    <nav className="tabs" aria-label={tr('Connection Policy sections')}>
      <Link className={`tab${tab === 'proxies' ? ' active' : ''}`} aria-current={tab === 'proxies' ? 'page' : undefined} to={destination('proxies')}>{tr('Proxies')}</Link>
      <Link className={`tab${tab === 'error-rules' ? ' active' : ''}`} aria-current={tab === 'error-rules' ? 'page' : undefined} to={destination('error-rules')}>{tr('Error Rules')}</Link>
    </nav>
    {/* One owner per existing editor. Hidden workspaces stay mounted to preserve drafts and reads. */}
    <div hidden={tab !== 'proxies'}><OutboundProxyConfigSection onDirtyChange={setProxyDirty} /></div>
    <div hidden={tab !== 'error-rules'}><ProviderNetworkRulesPanel onDirtyChange={setRulesDirty} /></div>
    <Modal open={blocker.state === 'blocked'} onOpenChange={open => { if (!open && blocker.state === 'blocked') blocker.reset(); }} title={tr('Discard unsaved changes?')}>
      <p>{tr('Your changes have not been saved. Stay here to keep editing, or discard them and leave.')}</p>
      <div className="row-actions">
        <button type="button" className="btn-ghost" onClick={() => blocker.state === 'blocked' && blocker.reset()}>{tr('Cancel')}</button>
        <button type="button" className="btn-danger" onClick={() => blocker.state === 'blocked' && blocker.proceed()}>{tr('Discard and leave')}</button>
      </div>
    </Modal>
  </div>;
}

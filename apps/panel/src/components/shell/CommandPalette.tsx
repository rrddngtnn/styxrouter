import {ProviderIcon} from "../ProviderIcon";
import { useTranslator } from "../../lib/useTranslator.ts";
import { useEffect, useId, useRef, useState } from "react";
import { Dialog } from "@radix-ui/themes";
import { Search, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../../lib/api.ts";
import { navigation } from "./navigation.ts";
import { usePreferences } from "../../lib/preferences.tsx";

interface Provider { id: string; name?: string }

export function CommandPalette() {
  const tr = useTranslator();
  const { t } = usePreferences();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [revision, setRevision] = useState(0);
  const navigating = useRef(false);
  const [viewport, setViewport] = useState({height: window.visualViewport?.height ?? window.innerHeight, top: window.visualViewport?.offsetTop ?? 0});
  useEffect(() => { const update = () => setViewport({height: window.visualViewport?.height ?? window.innerHeight, top: window.visualViewport?.offsetTop ?? 0}); const vv=window.visualViewport; vv?.addEventListener("resize",update); vv?.addEventListener("scroll",update); window.addEventListener("resize",update); return () => { vv?.removeEventListener("resize",update); vv?.removeEventListener("scroll",update); window.removeEventListener("resize",update); }; }, []);
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const navigate = useNavigate();
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && !event.repeat && !event.isComposing) {
        // Don't stack the palette over another modal's focus trap.
        if (document.querySelector('[role="dialog"]') && !open) return;
        event.preventDefault();
        setOpen(value => !value);
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    navigating.current=false;
    if (!revision) { setQuery(''); setSelected(0); }
    setStatus('loading');
    const controller = new AbortController();
    api.get<{ providers?: Provider[] }>('/api/providers', controller.signal).then(data => {
      if (controller.signal.aborted) return;
      setProviders([...(data.providers ?? [])].sort((a,b)=>a.id.localeCompare(b.id)));
      setStatus('ok');
    }).catch(() => { if (!controller.signal.aborted) { setProviders([]); setStatus('error'); } });
    return () => controller.abort();
  }, [open, revision]);
  useEffect(() => { if (!open) { setQuery(''); setRevision(0); } }, [open]);
  const term = query.trim().toLowerCase();
  const results = [
    ...navigation.map(item => ({ label: t(item.label), detail: t(item.group), group: "Pages", providerId: undefined as string | undefined, to: item.to })),
    ...providers.map(provider => ({ label: provider.name || provider.id, detail: `${tr("Provider")} · ${provider.id}`, group: "Providers", providerId: provider.id, to: `/providers/${encodeURIComponent(provider.id)}` })),
  ].filter(item => `${item.label} ${item.detail}`.toLowerCase().includes(term));
  const active = Math.min(selected, Math.max(0, results.length - 1));
  useEffect(() => { if (!open) return; const element = document.getElementById(`${id}-${encodeURIComponent(results[active]?.to ?? "")}`);
    const list = element?.closest<HTMLElement>(".shell-palette-results");
    if (!element || !list) return;
    if (element.offsetTop < list.scrollTop) list.scrollTop = element.offsetTop;
    else if (element.offsetTop + element.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = element.offsetTop + element.offsetHeight - list.clientHeight; }, [active, id, query, providers]);
  function choose(index: number) {
    const item = results[index];
    if (!item) return;
    navigating.current=true;
    setOpen(false);
    navigate(item.to);
  }
  return <Dialog.Root open={open} onOpenChange={setOpen}>
    <Dialog.Trigger><button ref={trigger} type="button" className="shell-search-trigger" aria-label={t("Search pages and providers")} aria-keyshortcuts="Control+k Meta+k"><Search size={16} aria-hidden="true" /><span>{t("Search")}</span><kbd>{mac ? "⌘ K" : "Ctrl K"}</kbd></button></Dialog.Trigger>
    <Dialog.Content className="shell-palette" style={{"--palette-viewport-height": `${viewport.height}px`, "--palette-viewport-top": `${viewport.top}px`} as React.CSSProperties} onOpenAutoFocus={event => { event.preventDefault(); input.current?.focus(); }} onCloseAutoFocus={event => { event.preventDefault(); if (!navigating.current) trigger.current?.focus(); }}>
      <div className="shell-dialog-head"><Dialog.Title className="shell-dialog-title">{t("Go to")}</Dialog.Title><Dialog.Close><button type="button" className="shell-icon-button" aria-label={t("Close search")}><X size={18} /></button></Dialog.Close></div>
      <Dialog.Description className="shell-palette-description">{t("Find a page or provider. Use ↑ ↓ to select and Enter to open.")}</Dialog.Description>
      <input ref={input} className="shell-palette-input" role="combobox" aria-label={t("Search pages and providers")} aria-autocomplete="list" aria-expanded="true" aria-controls={`${id}-results`} aria-activedescendant={results.length ? `${id}-${encodeURIComponent(results[active]?.to ?? "")}` : undefined} value={query} placeholder={t("Search pages and providers…")} onChange={event => { setQuery(event.target.value); setSelected(0); }} onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          if (results.length) setSelected((active + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length);
        } else if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); choose(active); }
      }} />
      {query && <button type="button" className="btn-ghost" onClick={() => { setQuery(''); setSelected(0); input.current?.focus(); }}>{tr("Clear search")}</button>}
      <div className="shell-palette-results" id={`${id}-results`} role="listbox" aria-label={tr("Pages and providers")}>
        {['Pages','Providers'].map(group => <div key={group} role="group" aria-label={tr(group)}>
          <div className="shell-palette-group" aria-hidden="true">{tr(group)}</div>
          {results.map((item,index) => item.group === group && <div key={item.to} id={`${id}-${encodeURIComponent(item.to)}`} role="option" aria-selected={index===active} className="shell-palette-option" onPointerMove={() => setSelected(index)} onMouseDown={event => event.preventDefault()} onClick={() => choose(index)}><span className="palette-result-label">{item.providerId && <ProviderIcon providerId={item.providerId} label={item.label} size={20}/>} {item.label}</span><small>{item.detail}</small></div>)}
        </div>)}
      </div>
      <div className="shell-palette-status" role="status">{status === 'loading' ? tr("Loading providers…") : status === 'error' ? tr("Provider lookup unavailable. Pages are still available.") : results.length === 0 ? tr("No matching pages or providers.") : tr("{0} results", {0: String(results.length)})}</div>
      {status === 'error' && <button type="button" className="btn-ghost" onClick={() => setRevision(value => value+1)}>{tr("Retry")}</button>}
    </Dialog.Content>
  </Dialog.Root>;
}

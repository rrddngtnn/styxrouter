import { useEffect, useId, useRef, useState } from "react";
import { Dialog } from "@radix-ui/themes";
import { Search, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../../lib/api.ts";
import { navigation } from "./navigation.ts";

interface Provider { id: string; name?: string }

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
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
    setQuery('');
    setSelected(0);
    setStatus('loading');
    const controller = new AbortController();
    api.get<{ providers?: Provider[] }>('/api/providers', controller.signal).then(data => {
      if (controller.signal.aborted) return;
      setProviders(data.providers ?? []);
      setStatus('ok');
    }).catch(() => { if (!controller.signal.aborted) { setProviders([]); setStatus('error'); } });
    return () => controller.abort();
  }, [open]);
  const term = query.trim().toLowerCase();
  const results = [
    ...navigation.map(item => ({ label: item.label, detail: item.group, to: item.to })),
    ...providers.map(provider => ({ label: provider.name || provider.id, detail: `Provider · ${provider.id}`, to: `/providers/${encodeURIComponent(provider.id)}` })),
  ].filter(item => `${item.label} ${item.detail}`.toLowerCase().includes(term));
  const active = Math.min(selected, Math.max(0, results.length - 1));
  useEffect(() => { document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: 'nearest' }); }, [active, id, query]);
  function choose(index: number) {
    const item = results[index];
    if (!item) return;
    setOpen(false);
    navigate(item.to);
  }
  return <Dialog.Root open={open} onOpenChange={setOpen}>
    <Dialog.Trigger><button ref={trigger} type="button" className="shell-search-trigger" aria-label="Search pages and providers" aria-keyshortcuts="Control+k Meta+k"><Search size={16} aria-hidden="true" /><span>Search</span><kbd>Ctrl K</kbd></button></Dialog.Trigger>
    <Dialog.Content className="shell-palette" onOpenAutoFocus={event => { event.preventDefault(); input.current?.focus(); }} onCloseAutoFocus={event => { event.preventDefault(); trigger.current?.focus(); }}>
      <div className="shell-dialog-head"><Dialog.Title className="shell-dialog-title">Go to</Dialog.Title><Dialog.Close><button type="button" className="shell-icon-button" aria-label="Close search"><X size={18} /></button></Dialog.Close></div>
      <Dialog.Description className="shell-palette-description">Find a page or provider. Use ↑ ↓ to select and Enter to open.</Dialog.Description>
      <input ref={input} className="shell-palette-input" role="combobox" aria-label="Search pages and providers" aria-autocomplete="list" aria-expanded="true" aria-controls={`${id}-results`} aria-activedescendant={results.length ? `${id}-${active}` : undefined} value={query} placeholder="Search pages and providers…" onChange={event => { setQuery(event.target.value); setSelected(0); }} onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          if (results.length) setSelected((active + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length);
        } else if (event.key === 'Enter') { event.preventDefault(); choose(active); }
      }} />
      <div className="shell-palette-results" id={`${id}-results`} role="listbox" aria-label="Pages and providers">
        {results.map((item, index) => <div key={item.to} id={`${id}-${index}`} role="option" aria-selected={index === active} className="shell-palette-option" onMouseDown={event => event.preventDefault()} onClick={() => choose(index)}><span>{item.label}</span><small>{item.detail}</small></div>)}
      </div>
      <div className="shell-palette-status" role="status">{status === 'loading' ? 'Loading providers…' : status === 'error' ? 'Provider lookup unavailable. Pages are still available; reopen to retry.' : results.length === 0 ? 'No matching pages or providers.' : `${results.length} results`}</div>
    </Dialog.Content>
  </Dialog.Root>;
}

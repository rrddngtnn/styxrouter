import { useState } from "react";
import { Dialog } from "@radix-ui/themes";
import {useMobile} from '../lib/use-mobile';

/** Owners retain exact tag-query semantics. Draft changes never trigger a read. */
export function TagFilter({value, applied, onChange, onApply, onClear, disabled = false, tr}: {
  value: string; applied: string; onChange: (value: string) => void;
  onApply: () => void; onClear: () => void; disabled?: boolean; tr: (value: string) => string;
}) {
  const [open,setOpen]=useState(false);
  const mobile=useMobile();
  const changeOpen=(next:boolean)=>{onChange(applied);setOpen(next);};
  return <Dialog.Root open={open} onOpenChange={changeOpen}>
    <Dialog.Trigger><button type="button" className="btn-ghost tag-filter-trigger" disabled={disabled} aria-label={`${tr("Tags")}${applied ? " (1)" : ""}`}>
      {tr("Tags")}{applied && <span className="tag-filter-count">1</span>}
    </button></Dialog.Trigger>
    <Dialog.Content className={`tag-filter-dialog ${mobile ? 'is-mobile' : ''}`}>
      <Dialog.Title>{tr("Filter by tag")}</Dialog.Title>
      <Dialog.Description>{tr("Apply a tag filter to this resource list.")}</Dialog.Description>
      <form onSubmit={event=>{event.preventDefault();onApply();setOpen(false);}}>
        <label>{tr("Filter by tag")}<input type="search" aria-label={tr("Filter by tag")} maxLength={64} value={value} disabled={disabled} onChange={event=>onChange(event.target.value)} /></label>
        {applied && <span className="tag-filter-chip">{applied}</span>}
        <div className="tag-filter-actions">
          <button type="button" className="btn-ghost" disabled={disabled} onClick={()=>{onClear();setOpen(false);}}>{tr("Clear tag filter")}</button>
          <button type="button" className="btn-ghost" onClick={()=>changeOpen(false)}>{tr("Cancel")}</button>
          <button type="submit" className="btn-add" disabled={disabled||!value.trim()}>{tr("Apply tag filter")}</button>
        </div>
      </form>
    </Dialog.Content>
  </Dialog.Root>;
}

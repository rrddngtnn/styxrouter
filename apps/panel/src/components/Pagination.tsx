import { useTranslator } from "../lib/useTranslator.ts";
import { paginationItems, paginationState } from "../lib/pagination.ts";
import "./pagination.css";

export interface PaginationProps {
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  itemLabel?: string;
  label?: string;
  pageSizeOptions?: readonly number[];
  onPageSizeChange?: (pageSize: number) => void;
}

/** Controlled, one-based pagination. Owners slice data and reset the page when filters change. */
export function Pagination({ total, page, pageSize, onPageChange, itemLabel = "items", label = "Pagination", pageSizeOptions = [8, 16, 32], onPageSizeChange }: PaginationProps) {
  const tr = useTranslator();
  const state = paginationState(total, pageSize, page);
  return <nav className="pagination" aria-label={label}>
    <div className="pagination-summary" role="status" aria-live="polite">
      <span>{state.start}–{state.end} {tr("of")} {state.total} {tr(itemLabel)}</span>
      <span className="muted">{tr("Page")} {state.page} {tr("of")} {state.pages}</span>
    </div>
    <div className="pagination-pages">
      <button type="button" className="btn-ghost" disabled={state.page === 1} onClick={() => onPageChange(state.page - 1)}>{tr("Previous")}</button>
      {paginationItems(state.page, state.pages).map((item, index) => item === "ellipsis"
        ? <span className="pagination-ellipsis" key={`gap-${index}`} aria-hidden="true">…</span>
        : <button type="button" className="btn-ghost pagination-number" key={item} aria-label={tr("Go to page {0}", {0: String(item)})} aria-current={item === state.page ? "page" : undefined} disabled={!state.total} onClick={() => onPageChange(item)}>{item}</button>)}
      <button type="button" className="btn-ghost" disabled={state.page === state.pages} onClick={() => onPageChange(state.page + 1)}>{tr("Next")}</button>
    </div>
    <div className="pagination-options">
      {onPageSizeChange && <label>{tr("Items per page")}<select value={state.pageSize} onChange={event => { onPageSizeChange(Number(event.target.value)); onPageChange(1); }}>
        {[...new Set([...pageSizeOptions, state.pageSize])].filter(size => Number.isInteger(size) && size > 0).sort((a, b) => a - b).map(size => <option key={size} value={size}>{size}</option>)}
      </select></label>}
      {state.pages > 7 && <form key={`${state.page}-${state.pages}`} onSubmit={event => {
        event.preventDefault();
        const input = event.currentTarget.elements.namedItem("page") as HTMLInputElement;
        if (!input.checkValidity()) return;
        onPageChange(paginationState(state.total, state.pageSize, input.valueAsNumber).page);
      }}><label>{tr("Go to page")}<input name="page" type="number" min={1} max={state.pages} step={1} defaultValue={state.page} required /></label><button type="submit" className="btn-ghost">{tr("Go")}</button></form>}
    </div>
  </nav>;
}

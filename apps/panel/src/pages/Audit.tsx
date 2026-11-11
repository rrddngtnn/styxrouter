import {ProgressiveFilters,InspectionFallback} from "../components/ProgressiveFilters";
import {useFilterQuery,pageValues,pageSizes} from "../lib/filter-query";
import {ResourceInspector,ResourceRows,ResourceRow,useResourceInspection} from "../components/ResourceWorkspace";
import {ReadFreshness} from "../components/OperationalUI";
import { useTranslator } from "../lib/useTranslator.ts";
import { useEffect, useMemo, useState } from "react";
import { Copy, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, LoadingState } from "../components/PageStates.tsx";
import { TableScroll } from "../components/TableScroll.tsx";
import { Pagination } from "../components/Pagination.tsx";

import { DASH, when } from "../lib/format.ts";
import { paginationState } from "../lib/pagination.ts";
import { useFetch } from "../lib/useFetch.ts";

export interface AuditEntry {
  id: number;
  timestamp: string;
  action: string;
  actor: string;
  target: string | null;
  details: unknown;
  status: string | null;
}

/** Admin action history (keys, combos, accounts, settings writes) from the audit log. */
export function Audit() {
  const tr = useTranslator();
  const state = useFetch<{ entries?: AuditEntry[]; total?: number }>("/api/audit-log?limit=200");
  const [filter, setFilter] = useState("");

  const [selected, setSelected] = useState<AuditEntry | null>(null);

  const entries = state.status === "ok" ? state.data.entries ?? [] : [];
  const inspection=useResourceInspection(entries,row=>String(row.id));
  const activeEntry=inspection.mobile?inspection.selected:selected;
  const openEntry=(entry:AuditEntry)=>inspection.mobile?inspection.open(entry):setSelected(entry);
  const actions = useMemo(
    () => [...new Set(entries.map((e) => e.action).filter(Boolean))].sort(),
    [entries],
  );

  const query=useFilterQuery({action:["all",...actions],page:pageValues,size:pageSizes},{action:"all",page:"1",size:"20"});
  const actionFilter=query.values.action;const page=Number(query.values.page);const pageSize=Number(query.values.size);
  const setActionFilter=(action:string)=>query.commit({action,page:"1"});const setPage=(page:number)=>query.commit({page:String(page)});const setPageSize=(size:number)=>query.commit({size:String(size),page:"1"});
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return entries.filter((e) => {
      if (actionFilter !== "all" && e.action !== actionFilter) return false;
      if (!q) return true;
      return `${e.action} ${e.target ?? ""} ${e.actor} ${summarize(e.details)}`.toLowerCase().includes(q);
    });
  }, [entries, filter, actionFilter]);

  const pg = paginationState(shown.length, pageSize, page);
  useEffect(()=>{if(state.status==="ok"&&page!==pg.page)query.commit({page:String(pg.page)},true);},[page,pg.page,state.status==="ok"]);
  const pageRows = shown.slice(Math.max(0, pg.start - 1), pg.end);

  return (
    <div className={`page ${inspection.mobile&&inspection.inspect?"r6-detail-page":""}`}>
      <ReadFreshness state={state} />
      <div className="section-head" style={{ marginBottom: 16 }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>{tr("Audit log")}</h1>
          <p className="muted" style={{ margin: 0 }}>{tr("Every admin mutation recorded by the router. Click any row to inspect the full payload.")}</p>
        </div>
        <button type="button" className="btn-ghost" onClick={state.reload}>
          <RefreshCw size={14} />
          <span>{tr("Reload")}</span>
        </button>
      </div>

      {inspection.mobile ? <div className="toolbar"><input type="search" aria-label={tr("Filter by action, target, actor, or detail…")} placeholder={tr("Filter by action, target, actor, or detail…")} value={filter} onChange={e=>{setFilter(e.target.value);setPage(1);}}/><ProgressiveFilters value={{action:actionFilter}} defaults={{action:"all"}} onApply={v=>setActionFilter(v.action)}>{(draft,setDraft)=><label>{tr("Filter by action")}<select aria-label={tr("Filter by action")} value={draft.action} onChange={e=>setDraft({action:e.target.value})}><option value="all">{tr("All")}</option>{actions.map(a=><option key={a}>{a}</option>)}</select></label>}</ProgressiveFilters><span className="muted">{shown.length} / {entries.length} · {state.data?.total??"—"} {tr("total")}</span></div> : <div className="toolbar">
        <input
          type="search"
          placeholder={tr("Filter by action, target, actor, or detail…")}
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);setPage(1);
          }}
          style={{ minWidth: 340 }}
        />
        <select
          aria-label={tr("Filter by action")}
          value={actionFilter}
          onChange={(e) => {
            setActionFilter(e.target.value);
          }}
        >
          <option value="all">{tr("All actions (")}{entries.length})</option>
          {actions.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <span className="muted" style={{ marginLeft: "auto" }}>
          {shown.length} {tr(shown.length === 1 ? "entry" : "entries")}
        </span>
      </div>

      }

      {state.status === "loading" && <LoadingState label={tr("Loading audit log")} />}
      {state.status === "error" && <p className="bad">{state.error.message}</p>}
      {state.status === "ok" && shown.length === 0 && (
        <EmptyState
          title={tr("No audit entries")}
          description={filter || actionFilter !== "all" ? tr("No entries match your active filters.") : tr("Admin mutations will appear here once recorded.")}
          action={
            filter || actionFilter !== "all" ? (
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  setFilter("");
                  setActionFilter("all");
                }}
              >
                Reset filters
              </button>
            ) : undefined
          }
        />
      )}

      {!(inspection.mobile && inspection.inspect) && state.status === "ok" && shown.length > 0 && (
        <>
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            {inspection.mobile ? <ResourceRows label={tr("Audit entries")}>{pageRows.map(e=><ResourceRow key={e.id} title={e.action} onOpen={()=>openEntry(e)} summary={<>{when(e.timestamp)} · {e.actor}<p>{e.target??DASH} · {e.status??tr("unknown")}</p></>}/>)}</ResourceRows> : <TableScroll label={tr("Audit log table")} stickyPrimary>
            <table className="table fixed">
              <colgroup>
                <col style={{ width: "17%" }} />
                <col style={{ width: "22%" }} />
                <col style={{ width: "12%" }} />
                <col style={{ width: "20%" }} />
                <col />
              </colgroup>
              <thead>
                <tr>
                  <th>{tr("When")}</th>
                  <th>{tr("Action")}</th>
                  <th>{tr("Actor")}</th>
                  <th>{tr("Target")}</th>
                  <th>{tr("Details")}</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((e) => (
                  <tr
                    key={e.id}
                    style={{ cursor: "pointer" }}
                    onClick={() => setSelected(e)}
                    title={tr("Click to inspect full audit entry")}
                  >
                    <td title={e.timestamp}><button type="button" className="table-detail-button" aria-label={tr("Inspect audit entry")} onClick={(event) => { event.stopPropagation(); setSelected(e); }}>{when(e.timestamp)}</button></td>
                    <td>
                      <code>{e.action}</code>
                    </td>
                    <td>{e.actor}</td>
                    <td className="ellip" title={e.target ?? undefined}>
                      {e.target ?? DASH}
                    </td>
                    <td className="ellip">
                      <code>{summarize(e.details) || DASH}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </TableScroll>}
          </div>
          <Pagination
            total={shown.length}
            page={pg.page}
            pageSize={pg.pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            pageSizeOptions={[15, 20, 50, 100]}
            itemLabel="entries"
            label={tr("Audit pagination")}
          />
        </>
      )}

      <ResourceInspector
        open={inspection.mobile?!!inspection.inspect:activeEntry !== null}
        onOpenChange={(open) => {
          if (!open) {if(inspection.mobile)inspection.close();else setSelected(null);}
        }}
        title={tr("Audit entry #{0}", {0: String(activeEntry?.id ?? "")})}
        description={activeEntry ? `${when(activeEntry.timestamp)} · ${activeEntry.action}` : ""}
        maxWidth="620px"
      >
        {!activeEntry && <InspectionFallback loading={state.pending}/>}
        {activeEntry && (
          <div className="stack-form" style={{ maxWidth: "100%" }}>
            <div className="two-col" style={{ gap: 12 }}>
              <div>
                <small className="muted">{tr("Action")}</small>
                <div>
                  <code>{activeEntry.action}</code>
                </div>
              </div>
              <div>
                <small className="muted">{tr("Actor & Status")}</small>
                <div>
                  {activeEntry.actor} · <code>{activeEntry.status ?? "ok"}</code>
                </div>
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <small className="muted">{tr("Target")}</small>
                <div>
                  <code>{activeEntry.target ?? DASH}</code>
                </div>
              </div>
            </div>
            <div>
              <div className="section-head" style={{ marginBottom: 6 }}>
                <small className="muted">{tr("Recorded details (JSON)")}</small>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() =>
                    navigator.clipboard
                      ?.writeText(formatJson(activeEntry.details))
                      .then(() => toast.success("Copied JSON details"))
                  }
                >
                  <Copy size={13} />
                  <span>{tr("Copy JSON")}</span>
                </button>
              </div>
              <pre className="json" style={{ margin: 0, maxHeight: 320 }}>
                {formatJson(activeEntry.details)}
              </pre>
            </div>
            <div className="row-actions">
              <button type="button" className="btn-ghost" onClick={() => {if(inspection.mobile)inspection.close();else setSelected(null);}}>{tr("Close")}</button>
            </div>
          </div>
        )}
      </ResourceInspector>
    </div>
  );
}

function summarize(details: unknown): string {
  if (details == null) return "";
  if (typeof details === "string") return details;
  try {
    return JSON.stringify(details).slice(0, 120);
  } catch {
    return "";
  }
}

function formatJson(details: unknown): string {
  if (details == null) return "{}";
  if (typeof details === "string") {
    try {
      return JSON.stringify(JSON.parse(details), null, 2);
    } catch {
      return details;
    }
  }
  try {
    return JSON.stringify(details, null, 2);
  } catch {
    return String(details);
  }
}

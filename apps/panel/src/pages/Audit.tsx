import { useTranslator } from "../lib/useTranslator.ts";
import { useMemo, useState } from "react";
import { Copy, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, LoadingState } from "../components/PageStates.tsx";
import { TableScroll } from "../components/TableScroll.tsx";
import { Pagination } from "../components/Pagination.tsx";
import { Modal } from "../lib/actions.tsx";
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
  const [actionFilter, setActionFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selected, setSelected] = useState<AuditEntry | null>(null);

  const entries = state.status === "ok" ? state.data.entries ?? [] : [];
  const actions = useMemo(
    () => [...new Set(entries.map((e) => e.action).filter(Boolean))].sort(),
    [entries],
  );

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return entries.filter((e) => {
      if (actionFilter !== "all" && e.action !== actionFilter) return false;
      if (!q) return true;
      return `${e.action} ${e.target ?? ""} ${e.actor} ${summarize(e.details)}`.toLowerCase().includes(q);
    });
  }, [entries, filter, actionFilter]);

  const pg = paginationState(shown.length, pageSize, page);
  const pageRows = shown.slice(Math.max(0, pg.start - 1), pg.end);

  return (
    <div className="page">
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

      <div className="toolbar">
        <input
          type="search"
          placeholder={tr("Filter by action, target, actor, or detail…")}
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setPage(1);
          }}
          style={{ minWidth: 340 }}
        />
        <select
          aria-label={tr("Filter by action")}
          value={actionFilter}
          onChange={(e) => {
            setActionFilter(e.target.value);
            setPage(1);
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
                  setPage(1);
                }}
              >
                Reset filters
              </button>
            ) : undefined
          }
        />
      )}

      {state.status === "ok" && shown.length > 0 && (
        <>
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <TableScroll label={tr("Audit log table")} stickyPrimary>
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
            </TableScroll>
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

      <Modal
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        title={tr("Audit entry #{0}", {0: String(selected?.id ?? "")})}
        description={selected ? `${when(selected.timestamp)} · ${selected.action}` : ""}
        maxWidth="620px"
      >
        {selected && (
          <div className="stack-form" style={{ maxWidth: "100%" }}>
            <div className="two-col" style={{ gap: 12 }}>
              <div>
                <small className="muted">{tr("Action")}</small>
                <div>
                  <code>{selected.action}</code>
                </div>
              </div>
              <div>
                <small className="muted">{tr("Actor & Status")}</small>
                <div>
                  {selected.actor} · <code>{selected.status ?? "ok"}</code>
                </div>
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <small className="muted">{tr("Target")}</small>
                <div>
                  <code>{selected.target ?? DASH}</code>
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
                      ?.writeText(formatJson(selected.details))
                      .then(() => toast.success("Copied JSON details"))
                  }
                >
                  <Copy size={13} />
                  <span>{tr("Copy JSON")}</span>
                </button>
              </div>
              <pre className="json" style={{ margin: 0, maxHeight: 320 }}>
                {formatJson(selected.details)}
              </pre>
            </div>
            <div className="row-actions">
              <button type="button" className="btn-ghost" onClick={() => setSelected(null)}>{tr("Close")}</button>
            </div>
          </div>
        )}
      </Modal>
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

import {useWorkspaceURL} from "../lib/workspace-url";
import {ProgressiveFilters,InspectionFallback} from "../components/ProgressiveFilters";
import {useFilterQuery,pageValues,pageSizes} from "../lib/filter-query";
import {ResourceInspector,ResourceRows,ResourceRow,useResourceInspection} from "../components/ResourceWorkspace";
import {ReadFreshness} from "../components/OperationalUI";
import { useTranslator } from "../lib/useTranslator.ts";
import { useWorkspaceTabs } from "../lib/workspace-tabs.ts";
import { useEffect, useMemo, useState } from "react";
import { Copy, Play, Radio, RefreshCw, Terminal } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { EmptyState, LoadingState } from "../components/PageStates.tsx";
import { TableScroll } from "../components/TableScroll.tsx";
import { Pagination } from "../components/Pagination.tsx";
import { WebhookAlertsSection } from "../components/settings/HealthAndVersionsSettings.tsx";

import { api } from "../lib/api.ts";
import { decodeUpstreamError } from "../lib/error-decoder.ts";
import { DASH, int, ms, when } from "../lib/format.ts";
import { paginationState } from "../lib/pagination.ts";
import { useFetch } from "../lib/useFetch.ts";
import { pollEligible } from "../lib/polling.ts";

export function buildActivityReplayCurl(row: {
  path?: string;
  model?: string;
  provider?: string;
  comboName?: string | null;
}, origin = "http://127.0.0.1:20128"): string {
  const endpoint = row.path?.startsWith("/v1/") ? row.path : "/v1/chat/completions";
  const modelTarget = row.comboName
    ? row.comboName
    : row.provider && row.model && !row.model.includes("/")
      ? `${row.provider}/${row.model}`
      : row.model ?? "glm/glm-5.3";
  const payload =
    endpoint === "/v1/responses"
      ? { model: modelTarget, input: "ping" }
      : {
          model: modelTarget,
          max_tokens: 64,
          messages: [{ role: "user", content: "ping" }],
        };
  return `curl -sS ${origin}${endpoint} \\\n  -H "Authorization: Bearer $STYX_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(payload)}'`;
}

export interface CallLog {
  id: string;
  timestamp: string;
  method?: string;
  path?: string;
  status?: number;
  model?: string;
  provider?: string;
  providerDisplay?: string;
  account?: string;
  duration?: number;
  tokens?: { in?: number | null; out?: number | null };
  apiKeyName?: string;
  comboName?: string | null;
  error?: string | null;
}

export function Activity() {
  const tr = useTranslator();
  const [searchParams] = useSearchParams();
  const query=useFilterQuery({errors:["false","true"],limit:["100","250","500"],page:pageValues,size:pageSizes},{errors:"false",limit:"250",page:"1",size:"20"});
  const limit=Number(query.values.limit),onlyErrors=query.values.errors==="true",page=Number(query.values.page),pageSize=Number(query.values.size);
  const [q,setQ]=useState(()=>searchParams.get("q")??"");
  const setLimit=(n:number)=>query.commit({limit:String(n),page:"1"});const setPage=(n:number)=>query.commit({page:String(n)});const setPageSize=(n:number)=>query.commit({size:String(n),page:"1"});
  const [selected, setSelected] = useState<CallLog | null>(null);
  const [liveTail, setLiveTail] = useState(false);
  const [workspaceTab, setWorkspaceTab] = useWorkspaceURL(["logs","webhooks"] as const,"logs");
  const workspaceTabs = useWorkspaceTabs(workspaceTab);
  const [dryRunNote, setDryRunNote] = useState<string | null>(null);
  const [dryRunBusy, setDryRunBusy] = useState(false);

  const toggleErrors=(checked:boolean)=>query.commit({errors:String(checked),page:"1"});
  useEffect(()=>setQ(searchParams.get("q")??""),[searchParams.get("q")]);

  const state = useFetch<CallLog[]>(`/api/usage/call-logs?limit=${limit}`);
  useEffect(() => {
    if (!liveTail || workspaceTab !== "logs") return;
    const timer = setInterval(() => {
      if(pollEligible({enabled:liveTail,visible:document.visibilityState==="visible",active:workspaceTab==="logs",pending:state.pending}))state.reload();
    }, 3000);
    return () => clearInterval(timer);
  }, [liveTail, workspaceTab, state.pending, state.reload]);
  const provs = useFetch<{ providers?: { id: string; name?: string }[] }>("/api/providers");
  const nodes = useFetch<{ nodes?: { id: string; name: string; prefix: string | null }[] }>("/api/provider-nodes");
  const providerNames = useMemo(() => {
    const map = new Map((provs.data?.providers ?? []).map((p) => [p.id, p.name ?? p.id]));
    for (const n of nodes.data?.nodes ?? []) {
      map.set(n.id, n.prefix ? `${n.name} (${n.prefix})` : n.name);
    }
    return map;
  }, [provs.data, nodes.data]);

  const resolveProvider = (r: CallLog) => {
    const raw = r.provider ?? r.providerDisplay;
    if (!raw) return DASH;
    return providerNames.get(raw) ?? (r.providerDisplay ? providerNames.get(r.providerDisplay) : undefined) ?? r.providerDisplay ?? raw;
  };

  const rows = useMemo(() => {
    const all = state.status === "ok" && Array.isArray(state.data) ? state.data : [];
    const needle = q.trim().toLowerCase();
    return all.filter((r) => {
      if (onlyErrors && !(r.status && r.status >= 400)) return false;
      if (!needle) return true;
      return [r.model, resolveProvider(r), r.provider, r.account, r.apiKeyName, r.path, r.error].some((v) =>
        v?.toLowerCase().includes(needle),
      );
    });
  }, [state, onlyErrors, q, providerNames]);

  const inspection=useResourceInspection(state.data??[],row=>String(row.id));
  const activeEntry=inspection.mobile?inspection.selected:selected;
  const pg = paginationState(rows.length, pageSize, page);
  useEffect(()=>{if(state.status==="ok"&&page!==pg.page)query.commit({page:String(pg.page)},true);},[page,pg.page,state.status==="ok"]);
  const pageRows = rows.slice(Math.max(0, pg.start - 1), pg.end);

  return (
    <div className={`page ${inspection.mobile&&inspection.inspect?"r6-detail-page":""}`}>
      <ReadFreshness state={state} /><ReadFreshness resource="Providers" state={provs}/><ReadFreshness resource="Custom Providers" state={nodes}/>
      <div className="section-head" style={{ marginBottom: 16 }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>{tr("Activity")}</h1>
          <p className="muted" style={{ margin: 0 }}>{tr("Recent request telemetry and upstream error diagnostics. Click any row to inspect full details.")}</p>
        </div>
        <div className="row-actions">
          {workspaceTab === "logs" && (
            <>
              <button
                type="button"
                className={liveTail ? "btn-add" : "btn-ghost"}
                aria-pressed={liveTail}
                onClick={() => setLiveTail((v) => !v)}
              >
                <Radio size={14} />
                <span>{liveTail ? tr("Live tail: ON") : tr("Live tail")}</span>
              </button>
              <button type="button" className="btn-ghost" onClick={state.reload}>
                <RefreshCw size={14} />
                <span>{tr("Refresh")}</span>
              </button>
            </>
          )}
        </div>
      </div>

      {inspection.mobile ? <label className="mobile-category-select">{tr("Activity workspace")}<select aria-label={tr("Activity workspace")} value={workspaceTab} onChange={e=>setWorkspaceTab(e.target.value as typeof workspaceTab)}><option value="logs">{tr("Request Log")}</option><option value="webhooks">{tr("Alert Webhooks")}</option></select></label> : <div className="tabs" role="tablist" onKeyDown={workspaceTabs.onKeyDown} aria-label={tr("Activity workspace")}>
        <button
          type="button"
          role="tab"
          {...workspaceTabs.tabProps("logs")}
          aria-selected={workspaceTab === "logs"}
          className={workspaceTab === "logs" ? "tab active" : "tab"}
          onClick={() => setWorkspaceTab("logs")}
        >
          <span>{tr("Request Log")}</span>
          <span className="tab-count">{rows.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          {...workspaceTabs.tabProps("webhooks")}
          aria-selected={workspaceTab === "webhooks"}
          className={workspaceTab === "webhooks" ? "tab active" : "tab"}
          onClick={() => setWorkspaceTab("webhooks")}
        >
          <span>{tr("Alert Webhooks")}</span>
        </button>
      </div>}

      <div {...workspaceTabs.panelProps}>
      {workspaceTab === "webhooks" && <WebhookAlertsSection />}
      {workspaceTab === "logs" && (
        <>

      {inspection.mobile ? <div className="toolbar"><input type="search" aria-label={tr("Filter by model, provider, account, key, or error…")} placeholder={tr("Filter by model, provider, account, key, or error…")} value={q} onChange={e=>{setQ(e.target.value);setPage(1);}}/><ProgressiveFilters value={{errors:String(onlyErrors),limit:String(limit)}} defaults={{errors:"false",limit:"250"}} onApply={v=>query.commit({...v,page:"1"})}>{(draft,setDraft)=><><label><input type="checkbox" checked={draft.errors==="true"} onChange={e=>setDraft({...draft,errors:String(e.target.checked)})}/>{tr("errors only")}</label><label>{tr("Fetch window")}<select aria-label={tr("Fetch window")} value={draft.limit} onChange={e=>setDraft({...draft,limit:e.target.value})}>{[100,250,500].map(n=><option key={n} value={n}>{tr("Last {0} requests",{0:String(n)})}</option>)}</select></label></>}</ProgressiveFilters><span className="muted">{rows.length} {tr("requests")}</span></div> : <div className="toolbar">
        <input
          type="search"
          placeholder={tr("Filter by model, provider, account, key, or error…")}
          aria-label={tr("Filter by model, provider, account, key, or error…")}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          style={{ width: "min(100%, 340px)", minWidth: 0 }}
        />
        <label className="check">
          <input type="checkbox" checked={onlyErrors} onChange={(e) => toggleErrors(e.target.checked)} />{tr("errors only")}</label>
        <select
          value={limit}
          onChange={(e) => {
            setLimit(Number(e.target.value));
          }}
          aria-label={tr("Fetch window")}
        >
          {[100, 250, 500].map((n) => (
            <option key={n} value={n}>{tr("Last {0} requests", {0: String(n)})}</option>
          ))}
        </select>
        <span className="muted" style={{ marginLeft: "auto" }}>
          {rows.length} {tr(rows.length === 1 ? "request" : "requests")}
        </span>
      </div>

      }

      {state.status === "loading" && <LoadingState label={tr("Loading recent requests")} />}
      {state.status === "error" && <p className="bad">{state.error.message}</p>}
      {state.status === "ok" && rows.length === 0 && (
        <EmptyState
          title={tr("No matching requests")}
          description={
            onlyErrors || q
              ? tr("No requests match the active filters.")
              : tr("Requests sent to /v1/chat/completions, /v1/messages, or /v1/responses will appear here.")
          }
          action={
            onlyErrors || q ? (
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  setQ("");
                  toggleErrors(false);
                }}
              >
                Clear filters
              </button>
            ) : undefined
          }
        />
      )}

      {!(inspection.mobile && inspection.inspect) && state.status === "ok" && rows.length > 0 && (
        <>
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            {inspection.mobile ? <ResourceRows label={tr("Requests")}>{pageRows.map(r=><ResourceRow key={r.id} title={r.model??DASH} onOpen={()=>inspection.open(r)} summary={<>{when(r.timestamp)} · HTTP {r.status??DASH}<p>{resolveProvider(r)} · {ms(r.duration)}</p><p>{r.account??DASH}</p></>}/>)}</ResourceRows> : <TableScroll label={tr("Activity table")} stickyPrimary>
            <table className="table">
              <thead>
                <tr>
                  <th>{tr("Time")}</th>
                  <th>{tr("Key")}</th>
                  <th>{tr("Provider")}</th>
                  <th>{tr("Account")}</th>
                  <th>{tr("Model")}</th>
                  <th>{tr("Status")}</th>
                  <th>{tr("Latency")}</th>
                  <th>{tr("Tokens in/out")}</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => {
                  const isErr = Boolean(r.status && r.status >= 400);
                  return (
                    <tr
                      key={r.id}
                      className={isErr ? "row-bad" : ""}
                      style={{ cursor: "pointer" }}
                      onClick={() => setSelected(r)}
                      title={tr("Click to inspect request details")}
                    >
                      <td className="nowrap"><button type="button" className="table-detail-button" aria-label={tr("Inspect request details")} onClick={(event) => { event.stopPropagation(); setSelected(r); }}>{when(r.timestamp)}</button></td>
                      <td>{r.apiKeyName ?? DASH}</td>
                      <td>{resolveProvider(r)}</td>
                      <td>{r.account ?? DASH}</td>
                      <td>
                        <div>
                          <code>{r.model ?? DASH}</code>
                          {r.comboName ? <span className="muted"> via {r.comboName}</span> : null}
                        </div>
                        {r.error && (
                          <div
                            className="bad"
                            style={{
                              fontSize: 14,
                              marginTop: 3,
                              maxWidth: 420,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {r.error}
                          </div>
                        )}
                      </td>
                      <td className={isErr ? "bad" : "ok"}>{r.status ?? DASH}</td>
                      <td>{ms(r.duration)}</td>
                      <td>{r.tokens ? `${int(r.tokens.in)} / ${int(r.tokens.out)}` : DASH}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </TableScroll>}
          </div>
          <Pagination
            total={rows.length}
            page={pg.page}
            pageSize={pg.pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            pageSizeOptions={[15, 20, 50, 100]}
            itemLabel="requests"
            label={tr("Activity pagination")}
          />
        </>
      )}

      <ResourceInspector
        open={inspection.mobile?!!inspection.inspect:activeEntry !== null}
        onOpenChange={(open) => {
          if (!open) {
            if(inspection.mobile)inspection.close();else setSelected(null);
            setDryRunNote(null);
          }
        }}
        title={tr("Request detail — HTTP {0}", {0: String(activeEntry?.status ?? "—")})}
        description={activeEntry ? `${when(activeEntry.timestamp)} · ${activeEntry.method ?? "POST"} ${activeEntry.path ?? "/v1/chat/completions"}` : ""}
        maxWidth="620px"
      >
        {!activeEntry && <InspectionFallback loading={state.pending}/>}
        {activeEntry && (
          <div className="stack-form" style={{ maxWidth: "100%" }}>
            <div className="two-col" style={{ gap: 12 }}>
              <div>
                <small className="muted">{tr("Model")}</small>
                <div>
                  <code>{activeEntry.model ?? DASH}</code>
                </div>
              </div>
              <div>
                <small className="muted">{tr("Provider / Account")}</small>
                <div>
                  {resolveProvider(activeEntry)} · <code>{activeEntry.account ?? DASH}</code>
                </div>
              </div>
              <div>
                <small className="muted">{tr("Client API key")}</small>
                <div>{activeEntry.apiKeyName ?? DASH}</div>
              </div>
              <div>
                <small className="muted">{tr("Latency & Tokens")}</small>
                <div>
                  {ms(activeEntry.duration)} ·{" "}
                  {activeEntry.tokens ? tr("{0} in / {1} out", {0: String(int(activeEntry.tokens.in)),1: String(int(activeEntry.tokens.out))}) : DASH}
                </div>
              </div>
            </div>
            {(activeEntry.error || (activeEntry.status != null && activeEntry.status >= 400)) ? (
              <div>
                {(() => {
                  const decoded = decodeUpstreamError({
                    provider: activeEntry.provider ?? activeEntry.providerDisplay,
                    status: activeEntry.status,
                    error: activeEntry.error,
                  });
                  return decoded ? (
                    <div className="card" style={{ padding: 12, marginBottom: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
                        <strong>{tr(decoded.title)}</strong>
                        <span className="vendor-badge">{decoded.code}</span>
                      </div>
                      <p className="muted" style={{ margin: "0 0 6px 0", fontSize: 14 }}>{tr(decoded.summary)}</p>
                      <p style={{ margin: 0, fontSize: 14 }}>
                        <strong>{tr("Recommended action")}:</strong> {tr(decoded.recommendedAction)}
                      </p>
                    </div>
                  ) : null;
                })()}
                {activeEntry.error && (
                  <>
                    <div className="section-head" style={{ marginBottom: 6 }}>
                      <small className="bad">{tr("Upstream error message")}</small>
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() =>
                          navigator.clipboard?.writeText(activeEntry.error ?? "").then(() => toast.success("Copied error message"))
                        }
                      >
                        <Copy size={13} />
                        <span>{tr("Copy error")}</span>
                      </button>
                    </div>
                    <pre
                      style={{
                        margin: 0,
                        padding: 12,
                        borderRadius: 6,
                        background: "var(--panel-2)",
                        border: "1px solid rgba(248, 113, 113, 0.35)",
                        color: "var(--bad)",
                        fontSize: 14,
                        whiteSpace: "pre-wrap",
                        overflowWrap: "anywhere",
                      }}
                    >
                      {activeEntry.error}
                    </pre>
                  </>
                )}
              </div>
            ) : (
              <p className="muted" style={{ margin: 0 }}>{tr("Completed without upstream errors.")}</p>
            )}
            {dryRunNote && (
              <div className="card" style={{ padding: 10, fontSize: 14 }} role="status">
                {dryRunNote}
              </div>
            )}
            <div className="row-actions" style={{ flexWrap: "wrap", gap: 8 }}>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  const origin = typeof location !== "undefined" ? location.origin : "http://127.0.0.1:20128";
                  const cmd = buildActivityReplayCurl(activeEntry, origin);
                  navigator.clipboard?.writeText(cmd).then(() => toast.success("Copied cURL command"));
                }}
              >
                <Terminal size={13} />
                <span>{tr("Copy cURL")}</span>
              </button>
              <button
                type="button"
                className="btn-ghost"
                disabled={dryRunBusy}
                onClick={async () => {
                  const target = activeEntry.comboName
                    ? activeEntry.comboName
                    : activeEntry.provider && activeEntry.model && !activeEntry.model.includes("/")
                      ? `${activeEntry.provider}/${activeEntry.model}`
                      : activeEntry.model ?? "";
                  if (!target) return;
                  setDryRunBusy(true);
                  setDryRunNote(null);
                  try {
                    const res = await api.post<{
                      winner: { provider: string; model: string; accountName: string | null; accountId: string } | null;
                      steps: Array<{ eligibleCount: number; candidates: unknown[] }>;
                    }>("/api/routing/dry-run", { target });
                    if (res.winner) {
                      setDryRunNote(
                        `Dry-run winner for ${target}: ${res.winner.provider}/${res.winner.model} → ${res.winner.accountName ?? res.winner.accountId.slice(0, 8)}`,
                      );
                    } else {
                      setDryRunNote(`Dry-run for ${target}: 0 eligible accounts currently available.`);
                    }
                  } catch (e) {
                    setDryRunNote(`Dry-run error: ${e instanceof Error ? e.message : String(e)}`);
                  } finally {
                    setDryRunBusy(false);
                  }
                }}
              >
                <Play size={13} />
                <span>{dryRunBusy ? "…" : tr("Dry-run route")}</span>
              </button>
              <button type="button" className="btn-ghost" onClick={() => { if(inspection.mobile)inspection.close();else setSelected(null); setDryRunNote(null); }}>{tr("Close")}</button>
            </div>
          </div>
        )}
      </ResourceInspector>
        </>
      )}
      </div>
    </div>
  );
}

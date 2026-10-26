import { useMemo, useState } from "react";
import { Copy, RefreshCw } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { EmptyState, LoadingState } from "../components/PageStates.tsx";
import { Pagination } from "../components/Pagination.tsx";
import { Modal } from "../lib/actions.tsx";
import { DASH, int, ms, when } from "../lib/format.ts";
import { paginationState } from "../lib/pagination.ts";
import { useFetch } from "../lib/useFetch.ts";

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
  const [searchParams, setSearchParams] = useSearchParams();
  const [limit, setLimit] = useState(250);
  const [onlyErrors, setOnlyErrors] = useState(() => searchParams.get("errors") === "true");
  const [q, setQ] = useState(() => searchParams.get("q") ?? "");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selected, setSelected] = useState<CallLog | null>(null);

  const toggleErrors = (checked: boolean) => {
    setOnlyErrors(checked);
    setPage(1);
    const next = new URLSearchParams(searchParams);
    if (checked) next.set("errors", "true");
    else next.delete("errors");
    setSearchParams(next, { replace: true });
  };

  const state = useFetch<CallLog[]>(`/api/usage/call-logs?limit=${limit}`);
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

  const pg = paginationState(rows.length, pageSize, page);
  const pageRows = rows.slice(Math.max(0, pg.start - 1), pg.end);

  return (
    <div className="page">
      <div className="section-head" style={{ marginBottom: 16 }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>Activity</h1>
          <p className="muted" style={{ margin: 0 }}>
            Recent request telemetry and upstream error diagnostics. Click any row to inspect full details.
          </p>
        </div>
        <button type="button" className="btn-ghost" onClick={state.reload}>
          <RefreshCw size={14} />
          <span>Refresh</span>
        </button>
      </div>

      <div className="toolbar">
        <input
          type="search"
          placeholder="Filter by model, provider, account, key, or error…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          style={{ minWidth: 340 }}
        />
        <label className="check">
          <input type="checkbox" checked={onlyErrors} onChange={(e) => toggleErrors(e.target.checked)} /> errors only
        </label>
        <select
          value={limit}
          onChange={(e) => {
            setLimit(Number(e.target.value));
            setPage(1);
          }}
          aria-label="Fetch window"
        >
          {[100, 250, 500].map((n) => (
            <option key={n} value={n}>
              Last {n} requests
            </option>
          ))}
        </select>
        <span className="muted" style={{ marginLeft: "auto" }}>
          {rows.length} {rows.length === 1 ? "request" : "requests"}
        </span>
      </div>

      {state.status === "loading" && <LoadingState label="Loading recent requests" />}
      {state.status === "error" && <p className="bad">{state.error.message}</p>}
      {state.status === "ok" && rows.length === 0 && (
        <EmptyState
          title="No matching requests"
          description={
            onlyErrors || q
              ? "No requests match the active filters."
              : "Requests sent to /v1/chat/completions, /v1/messages, or /v1/responses will appear here."
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

      {state.status === "ok" && rows.length > 0 && (
        <>
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Key</th>
                  <th>Provider</th>
                  <th>Account</th>
                  <th>Model</th>
                  <th>Status</th>
                  <th>Latency</th>
                  <th>Tokens in/out</th>
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
                      title="Click to inspect request details"
                    >
                      <td className="nowrap">{when(r.timestamp)}</td>
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
                              fontSize: 11.5,
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
          </div>
          <Pagination
            total={rows.length}
            page={pg.page}
            pageSize={pg.pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            pageSizeOptions={[15, 20, 50, 100]}
            itemLabel="requests"
            label="Activity pagination"
          />
        </>
      )}

      <Modal
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        title={`Request detail — HTTP ${selected?.status ?? "—"}`}
        description={selected ? `${when(selected.timestamp)} · ${selected.method ?? "POST"} ${selected.path ?? "/v1/chat/completions"}` : ""}
        maxWidth="620px"
      >
        {selected && (
          <div className="stack-form" style={{ maxWidth: "100%" }}>
            <div className="two-col" style={{ gap: 12 }}>
              <div>
                <small className="muted">Model</small>
                <div>
                  <code>{selected.model ?? DASH}</code>
                </div>
              </div>
              <div>
                <small className="muted">Provider / Account</small>
                <div>
                  {resolveProvider(selected)} · <code>{selected.account ?? DASH}</code>
                </div>
              </div>
              <div>
                <small className="muted">Client API key</small>
                <div>{selected.apiKeyName ?? DASH}</div>
              </div>
              <div>
                <small className="muted">Latency & Tokens</small>
                <div>
                  {ms(selected.duration)} ·{" "}
                  {selected.tokens ? `${int(selected.tokens.in)} in / ${int(selected.tokens.out)} out` : DASH}
                </div>
              </div>
            </div>
            {selected.error ? (
              <div>
                <div className="section-head" style={{ marginBottom: 6 }}>
                  <small className="bad">Upstream error message</small>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() =>
                      navigator.clipboard?.writeText(selected.error ?? "").then(() => toast.success("Copied error message"))
                    }
                  >
                    <Copy size={13} />
                    <span>Copy error</span>
                  </button>
                </div>
                <pre
                  style={{
                    margin: 0,
                    padding: 12,
                    borderRadius: 6,
                    background: "#08090a",
                    border: "1px solid rgba(248, 113, 113, 0.35)",
                    color: "#fca5a5",
                    fontSize: 12,
                    whiteSpace: "pre-wrap",
                    overflowWrap: "anywhere",
                  }}
                >
                  {selected.error}
                </pre>
              </div>
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                Completed without upstream errors.
              </p>
            )}
            <div className="row-actions">
              <button type="button" className="btn-ghost" onClick={() => setSelected(null)}>
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

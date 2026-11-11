import {useConfirmation} from "../components/ConfirmationDialog";
import {ResourceInspector,ResourceRows,ResourceRow,useResourceInspection} from "../components/ResourceWorkspace";
import {ReadFreshness} from "../components/OperationalUI";
import { useTranslator } from "../lib/useTranslator.ts";
import { useEffect, useRef, useState } from "react";
import {createConsequentialOperation} from "../lib/consequential-operation";
import { usePreferences } from "../lib/preferences.tsx";
import { filterKeys, visibleSelectedIds } from "../lib/table-search.ts";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { appendModelLine } from "../lib/model-selection.ts";
import { api } from "../lib/api.ts";
import { Modal, SecretBanner, useAction } from "../lib/actions.tsx";
import { EmptyState, LoadingState } from "../components/PageStates.tsx";
import { TableScroll } from "../components/TableScroll.tsx";
import { ModelPicker } from "../components/ModelPicker.tsx";
import { useFetch } from "../lib/useFetch.ts";

interface KeyRow {
  id?: string;
  name?: string;
  prefix?: string;
  createdAt?: string;
  lastUsedAt?: string | null;
  modelRestrictions?: string[] | null;
  allowedModels?: string[];
  allowedConnections?: string[];
  noLog?: boolean;
  usageLimitEnabled?: boolean;
  dailyUsageLimitUsd?: number | null;
  weeklyUsageLimitUsd?: number | null;
  maxRequestsPerDay?: number | null;
  maxRequestsPerMinute?: number | null;
  isActive?: boolean;
}

export function Keys() {
  const confirmation = useConfirmation();
  const reviewLock = useRef(false);
  const tr = useTranslator();
  const {t} = usePreferences();
  const [search, setSearch] = useState("");
  const state = useFetch<{ keys?: KeyRow[] }>("/api/keys");
  const rows = state.status === "ok" ? state.data.keys ?? [] : [];
  const inspection = useResourceInspection(rows, row=>String(row.id));
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<KeyRow | null>(null);
  const editorCanClose = useRef<() => Promise<boolean>>(async () => true);
  const [secret, setSecret] = useState<{ title: string; key: string } | null>(null);
  useEffect(() => {
    const hide = () => { if (document.hidden) setSecret(null); };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, []);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectionMode,setSelectionMode]=useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const { busy, error, run, confirmationDialog } = useAction(state.reload);
  const [, renderOperation] = useState(0);
  const regeneration = useRef(createConsequentialOperation(() => renderOperation(n => n + 1)));
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const locked = busy !== null || bulkBusy || regeneration.current.state !== 'idle';
  async function rereadKeys() {
    await api.get<{keys?: KeyRow[]}>("/api/keys");
    if (mounted.current) state.reload();
  }
  async function regenerate(row: KeyRow) {
    if (locked || reviewLock.current) return;
    const target = {...row};
    reviewLock.current = true;
    const accepted = await confirmation.confirm({title:tr("Regenerate API key?"),description:tr("The current key stops working immediately. Update every client using it."),resource:`${target.name ?? "API key"} / ${target.id}`,action:tr("Regenerate"),danger:true});
    reviewLock.current = false;
    if (!accepted || !mounted.current) return;
    row = target;
    setSecret(null);
    const result = await regeneration.current.run(
      () => api.post<{key: string}>(`/api/keys/${row.id}/regenerate`), rereadKeys,
    );
    if (result && mounted.current && !document.hidden) setSecret({title: `New key for “${row.name}”`, key: result.key});
  }

  const shown = filterKeys(rows, search);
  const selectedIds = visibleSelectedIds(shown, selected);

  async function bulkAction(action: "revoke" | "delete") {
    if (locked || reviewLock.current || selectedIds.length === 0) return;
    const ids = [...selectedIds];
    reviewLock.current = true;
    const msg =
      action === "delete"
        ? `Delete ${selectedIds.length} selected API key${selectedIds.length === 1 ? "" : "s"} permanently?`
        : `Revoke ${selectedIds.length} selected API key${selectedIds.length === 1 ? "" : "s"}?`;
    const accepted = await confirmation.confirm({title:tr(action === "delete" ? "Delete selected API keys?" : "Revoke selected API keys?"),description:msg,resource:ids.map(id=>`${rows.find(r=>r.id===id)?.name ?? "API key"} / ${id}`).join("\n"),action:tr(action === "delete" ? "Delete" : "Revoke"),danger:true});
    reviewLock.current = false;
    if (!accepted || !mounted.current) return;
    setBulkBusy(true);
    let ok = 0;
    let failed = 0;
    try {
      for (const id of ids) {
        try {
          if (action === "delete") await api.delete(`/api/keys/${encodeURIComponent(id)}`);
          else await api.post(`/api/keys/${encodeURIComponent(id)}/revoke`);
          ok += 1;
        } catch {
          failed += 1;
        }
      }
      if (failed === 0) toast.success(`Bulk ${action}: ${ok}/${ids.length} succeeded`);
      else toast.warning(`Bulk ${action}: ${ok} succeeded, ${failed} failed`);
      if (action === "delete") setSelected(new Set());
    } finally {
      setBulkBusy(false);
      state.reload();
    }
  }

  const keyActions = (r:KeyRow) => { const id=String(r.id); const active=r.isActive!==false; return <div className="row-actions">                      {active && (
                        <>
                          <button type="button" className="btn-ghost" disabled={locked} onClick={() => setEditing(r)}>
                            {t("Edit")}
                          </button>
                          <button
                            type="button"
                            className="btn-ghost"
                            disabled={locked}
                            onClick={() => void regenerate(r)}
                          >
                            {t("Regenerate")}
                          </button>
                          <button
                            type="button"
                            className="btn-ghost"
                            disabled={locked}
                            onClick={async () => {
                              const out = await run(`revoke-${id}`, () => api.post(`/api/keys/${id}/revoke`), {title:tr("Revoke API key?"),description:tr("Clients using this key will lose access."),resource:`${r.name ?? "API key"} / ${id}`,action:tr("Revoke"),danger:true});
                              if (out) toast.success(`Revoked key “${r.name}”`);
                            }}
                          >
                            {t("Revoke")}
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        className="btn-danger"
                        disabled={locked}
                        onClick={async () => {
                          const out = await run(`delete-${id}`, () => api.delete(`/api/keys/${id}`), {title:tr("Delete API key?"),description:tr("This permanently deletes the selected key."),resource:`${r.name ?? "API key"} / ${id}`,action:tr("Delete"),danger:true});
                          if (out) toast.success(`Deleted key “${r.name}”`);
                        }}
                      >
                        {t("Delete")}
                      </button></div>; };

  async function closeCreate() {
    if (name && !await confirmation.confirm({title:tr("Discard unsaved changes?"),description:tr("The unsaved API key draft will be lost."),resource:tr("New API key"),action:tr("Discard changes"),danger:true})) return;
    setCreating(false); setName("");
  }
  async function create(e: React.FormEvent) {
    e.preventDefault();
    const made = await run("create", () => api.post<{ key: string; name: string }>("/api/keys", { name: name.trim() }));
    if (made && mounted.current) {
      setCreating(false);
      if (!document.hidden) setSecret({ title: `New key “${made.name}”`, key: made.key });
      setName("");
      toast.success(`Created API key “${made.name}”`);
    }
  }

  return (
    <div className="page">
      {confirmation.dialog}{confirmationDialog}
      <ReadFreshness state={state} />
      {regeneration.current.state === 'uncertain' && <div role="alert" className="read-freshness">
        {tr("Regeneration outcome is uncertain. The old key may no longer work. Do not retry automatically. Reread key inventory before deciding on another action.")}
        <button type="button" className="btn-ghost" onClick={() => void regeneration.current.reconcile(rereadKeys)}>{tr("Reread key inventory")}</button>
      </div>}
      {regeneration.current.state === 'reconciling' && <p role="status">{tr("Rereading key inventory…")}</p>}
      <div className="section-head" style={{ marginBottom: 16 }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>{t("API Keys")}</h1>
          <p className="muted" style={{ margin: 0 }}>{tr("Keys that clients present as")}<code>Authorization: Bearer …</code> on <code>/v1</code>{tr(". Only a prefix is ever shown after creation.")}</p>
        </div>
        <button type="button" className="btn-add" disabled={locked} onClick={() => setCreating(true)}>
          <Plus size={14} />
          <span>{t("Create key")}</span>
        </button>
      </div>

      {secret && <SecretBanner title={secret.title} secret={secret.key} onDismiss={() => setSecret(null)} />}

      <Modal
        open={creating}
        onOpenChange={(open) => {
          if (open) setCreating(true); else closeCreate();
        }}
        title={tr("Create API key")}
        description={tr("Issue a new Bearer token for inference clients (/v1/chat/completions, /v1/messages, /v1/responses).")}
      >
        <form className="stack-form" onSubmit={create}>
          <label>{tr("Key name")}<input
              type="text"
              placeholder={tr("e.g. laptop, cursor-workstation, ci")}
              value={name}
              maxLength={200}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              required
            />
          </label>
          {error && <p className="bad">{error}</p>}
          <div className="row-actions">
            <button type="submit" className="btn-add" disabled={busy !== null || !name.trim()}>
              {busy === "create" ? "…" : "Create key"}
            </button>
            <button type="button" className="btn-ghost" onClick={closeCreate}>
              {t("Cancel")}
            </button>
          </div>
        </form>
      </Modal>

      <ResourceInspector
        open={editing !== null}
        onOpenChange={async (open) => {
          if (!open && await editorCanClose.current()) setEditing(null);
        }}
        title={tr("Edit API key — {0}", {0: String(editing?.name ?? "")})}
        description={tr("Configure rate limits and optional model restrictions for this key.")}
      >
        {editing && (
          <KeyEditor
            registerClose={(check) => { editorCanClose.current = check; }}
            row={editing}
            onSaved={() => {
              toast.success(`Updated key “${editing.name}”`);
              state.reload();
            }}
            onClose={() => setEditing(null)}
          />
        )}
      </ResourceInspector>

      {inspection.mobile && inspection.inspect ? <ResourceInspector open={editing===null} onOpenChange={open=>{if(!open)inspection.close();}} title={inspection.selected?.name ?? tr("Key not found")}><dl className="account-facts">{inspection.selected && Object.entries(inspection.selected).filter(([key])=>["id","name","prefix","createdAt","lastUsedAt","modelRestrictions","allowedModels","allowedConnections","noLog","usageLimitEnabled","dailyUsageLimitUsd","weeklyUsageLimitUsd","maxRequestsPerDay","maxRequestsPerMinute","isActive"].includes(key)).map(([key,value])=><div key={key}><dt>{key}</dt><dd>{typeof value==="object"?JSON.stringify(value):String(value??"—")}</dd></div>)}</dl>{inspection.selected&&keyActions(inspection.selected)}</ResourceInspector> : <>
      <div className="toolbar"><input type="search" aria-label={t("Search keys")} placeholder={t("Search keys")} value={search} onChange={e=>{setSearch(e.target.value);setSelected(new Set());}} />{search && <button type="button" className="btn-ghost" onClick={()=>{setSearch("");setSelected(new Set());}}>{t("Clear search")}</button>}<span className="muted" role="status">{shown.length} / {rows.length}</span></div>
      {state.status === "ok" && rows.length > 0 && shown.length === 0 && <EmptyState title={t("No matching keys")} />}
      {state.status === "loading" && <LoadingState label={tr("Loading API keys")} />}
      {state.status === "error" && <p className="bad">{state.error.message}</p>}
      {state.status === "ok" && rows.length === 0 && <EmptyState title={tr("No API keys")} description={tr("Create a key to authenticate clients with this router.")}
        action={<button type="button" className="btn-add" disabled={locked} onClick={() => setCreating(true)}>{t("Create key")}</button>} />}
      {state.status === "ok" && shown.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          {inspection.mobile && <button type="button" className="btn-ghost" onClick={()=>{setSelectionMode(value=>!value);setSelected(new Set());}}>{selectionMode?tr("Cancel selection"):tr("Select")}</button>}
          {(!inspection.mobile || selectionMode) && <div className="section-head" style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
            <label className="check">
              <input
                type="checkbox"
                disabled={locked}
                checked={selectedIds.length === shown.length && shown.length > 0}
                ref={(el) => {
                  if (el) el.indeterminate = selectedIds.length > 0 && selectedIds.length < shown.length;
                }}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setSelected(checked ? new Set(shown.map((r) => String(r.id))) : new Set());
                }}
              />
              {t("Select all filtered")} ({selectedIds.length}/{shown.length})
            </label>
            <div className="row-actions">
              <button
                type="button"
                className="btn-ghost"
                disabled={locked || selectedIds.length === 0}
                onClick={() => void bulkAction("revoke")}
              >
                {t("Revoke selected")}
              </button>
              <button
                type="button"
                className="btn-danger"
                disabled={locked || selectedIds.length === 0}
                onClick={() => void bulkAction("delete")}
              >
                {t("Delete selected")}
              </button>
            </div>
          </div>}
          {inspection.mobile ? <ResourceRows label={tr("API keys")}>{shown.map(r=><ResourceRow key={r.id} title={r.name??r.prefix??"—"} onOpen={()=>inspection.open(r)} summary={<>{r.prefix??"—"} · {r.isActive!==false?tr("active"):tr("revoked")}<p>{r.maxRequestsPerMinute??tr("unlimited")} / min · {r.maxRequestsPerDay??tr("unlimited")} / day</p></>}>{selectionMode&&<label className="check"><input type="checkbox" aria-label={tr("Select {0}",{0:String(r.name??r.id)})} checked={selected.has(String(r.id))} disabled={locked} onChange={e=>setSelected(old=>{const next=new Set(old);if(e.target.checked)next.add(String(r.id));else next.delete(String(r.id));return next;})}/>{tr("Select")}</label>}</ResourceRow>)}</ResourceRows> : <TableScroll label={t("API keys table")} stickySelection>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 36 }} />
                <th>{t("Name")}</th>
                <th>{t("Prefix")}</th>
                <th>{t("Limits")}</th>
                <th>{t("Created")}</th>
                <th>{t("Last used")}</th>
                <th>{t("Status")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const id = String(r.id);
                const active = r.isActive !== false;
                const limits = [
                  r.maxRequestsPerMinute ? `${r.maxRequestsPerMinute}/min` : null,
                  r.maxRequestsPerDay ? `${r.maxRequestsPerDay}/day` : null,
                  r.allowedModels?.length ? `${r.allowedModels.length} ${r.allowedModels.length === 1 ? "model" : "models"}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <tr key={id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={tr("Select {0}", {0: String(r.name ?? id)})}
                        disabled={locked}
                        checked={selected.has(id)}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setSelected((s) => {
                            const next = new Set(s);
                            if (checked) next.add(id);
                            else next.delete(id);
                            return next;
                          });
                        }}
                      />
                    </td>
                    <td><span className="table-identity">{r.name ?? "—"}</span></td>
                    <td>
                      <code>{r.prefix ?? "—"}</code>
                    </td>
                    <td className="muted">{limits || tr("unrestricted")}</td>
                    <td className="muted">{r.createdAt?.slice(0, 10) ?? "—"}</td>
                    <td className="muted">{r.lastUsedAt?.slice(0, 10) ?? tr("never")}</td>
                    <td className={active ? "ok" : "bad"}>{active ? tr("active") : tr("revoked")}</td>
                    <td className="row-actions">
{keyActions(r)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </TableScroll>}
        </div>
      )}
      </>}
    </div>
  );
}

const toLimit = (v: string) => (v.trim() === "" ? null : Number(v));

function KeyEditor({ row, onSaved, onClose, registerClose }: { row: KeyRow; onSaved: () => void; onClose: () => void; registerClose: (check: () => Promise<boolean>) => void }) {
  const tr = useTranslator();
  const { t } = usePreferences();
  const [name, setName] = useState(row.name ?? "");
  const [perDay, setPerDay] = useState(row.maxRequestsPerDay ? String(row.maxRequestsPerDay) : "");
  const [perMinute, setPerMinute] = useState(row.maxRequestsPerMinute ? String(row.maxRequestsPerMinute) : "");
  const [noLog, setNoLog] = useState<boolean>(Boolean(row.noLog));
  const [usageLimitEnabled, setUsageLimitEnabled] = useState<boolean>(Boolean(row.usageLimitEnabled));
  const [dailyUsd, setDailyUsd] = useState(row.dailyUsageLimitUsd != null ? String(row.dailyUsageLimitUsd) : "");
  const [weeklyUsd, setWeeklyUsd] = useState(row.weeklyUsageLimitUsd != null ? String(row.weeklyUsageLimitUsd) : "");
  const [connections, setConnections] = useState((row.allowedConnections ?? []).join("\n"));
  const [models, setModels] = useState((row.allowedModels ?? []).join("\n"));
  const [addedModel, setAddedModel] = useState("");
  const snapshot = JSON.stringify([name,perDay,perMinute,noLog,usageLimitEnabled,dailyUsd,weeklyUsd,connections,models,addedModel]);
  const initialSnapshot = useRef(snapshot);
  const confirmation = useConfirmation();
  const canClose = async () => snapshot === initialSnapshot.current || await confirmation.confirm({title:tr("Discard unsaved changes?"),description:tr("Unsaved key settings will be lost."),resource:`${row.name ?? "API key"} / ${row.id}`,action:tr("Discard changes"),danger:true});
  useEffect(() => { registerClose(canClose); return () => registerClose(async () => true); }, [snapshot]);
  const { busy, error, run } = useAction(onSaved);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const done = await run("save", () =>
      api.patch(`/api/keys/${row.id}`, {
        name: name.trim(),
        maxRequestsPerDay: toLimit(perDay),
        maxRequestsPerMinute: toLimit(perMinute),
        noLog,
        usageLimitEnabled,
        dailyUsageLimitUsd: toLimit(dailyUsd),
        weeklyUsageLimitUsd: toLimit(weeklyUsd),
        allowedConnections: connections.split("\n").map((c) => c.trim()).filter(Boolean),
        allowedModels: models.split("\n").map((m) => m.trim()).filter(Boolean),
      }),
    );
    if (done) onClose();
  }

  return (
    <form className="stack-form" onSubmit={save}>
      {confirmation.dialog}
      <label>
        {t("Name")}
        <input type="text" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} required />
      </label>
      <div className="two-col" style={{ gap: 12 }}>
        <label>{tr("Max requests / day")}<input type="number" min={1} step={1} placeholder={tr("unlimited")} value={perDay} onChange={(e) => setPerDay(e.target.value)} />
        </label>
        <label>{tr("Max requests / minute")}<input type="number" min={1} step={1} placeholder={tr("unlimited")} value={perMinute} onChange={(e) => setPerMinute(e.target.value)} />
        </label>
      </div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <label className="check">
          <input type="checkbox" checked={noLog} onChange={(e) => setNoLog(e.target.checked)} />
          <span>{tr("No-log mode (do not store prompt/response payloads)")}</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={usageLimitEnabled} onChange={(e) => setUsageLimitEnabled(e.target.checked)} />
          <span>{tr("Enforce USD spend budget")}</span>
        </label>
      </div>
      {usageLimitEnabled && (
        <div className="two-col" style={{ gap: 12 }}>
          <label>
            {tr("Daily USD limit")}
            <input type="number" min={0.01} step={0.01} placeholder={tr("unlimited")} value={dailyUsd} onChange={(e) => setDailyUsd(e.target.value)} />
          </label>
          <label>
            {tr("Weekly USD limit")}
            <input type="number" min={0.01} step={0.01} placeholder={tr("unlimited")} value={weeklyUsd} onChange={(e) => setWeeklyUsd(e.target.value)} />
          </label>
        </div>
      )}
      <label>
        {tr("Pinned account connection IDs (one per line, empty = all accounts)")}
        <textarea rows={2} placeholder={tr("Optional connection UUIDs")} value={connections} onChange={(e) => setConnections(e.target.value)} />
      </label>
      <div className="inline-form" style={{ alignItems: "start" }}>
        <ModelPicker label={tr("Find allowed model")} value={addedModel} onChange={setAddedModel} onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (addedModel.trim()) {
              setModels((current) => appendModelLine(current, addedModel, true));
              setAddedModel("");
            }
          }
        }} />
        <button type="button" className="btn-ghost" disabled={!addedModel.trim()} onClick={() => {
          setModels((current) => appendModelLine(current, addedModel, true));
          setAddedModel("");
        }}>{t("Add model")}</button>
      </div>
      <label>{tr("Allowed models (one per line, empty = all models)")}<textarea rows={4} placeholder={"antigravity/gemini-4-argon-high\nglm/glm-5.3-flash"} value={models} onChange={(e) => setModels(e.target.value)} />
      </label>
      {error && <p className="bad">{error}</p>}
      <div className="row-actions">
        <button type="submit" className="btn-add" disabled={busy !== null || !name.trim()}>
          {busy ? "…" : tr("Save changes")}
        </button>
        <button type="button" className="btn-ghost" onClick={async () => { if (await canClose()) onClose(); }}>
          {t("Cancel")}
        </button>
      </div>
    </form>
  );
}

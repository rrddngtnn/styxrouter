import { useTranslator } from "../lib/useTranslator.ts";
import { useState } from "react";
import { usePreferences } from "../lib/preferences.tsx";
import { filterKeys, visibleSelectedIds } from "../lib/table-search.ts";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { appendModelLine } from "../lib/model-selection.ts";
import { api } from "../lib/api.ts";
import { Modal, SecretBanner, useAction } from "../lib/actions.tsx";
import { EmptyState, LoadingState } from "../components/PageStates.tsx";
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
  maxRequestsPerDay?: number | null;
  maxRequestsPerMinute?: number | null;
  isActive?: boolean;
}

export function Keys() {
  const tr = useTranslator();
  const {t} = usePreferences();
  const [search, setSearch] = useState("");
  const state = useFetch<{ keys?: KeyRow[] }>("/api/keys");
  const rows = state.status === "ok" ? state.data.keys ?? [] : [];
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<KeyRow | null>(null);
  const [secret, setSecret] = useState<{ title: string; key: string } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const { busy, error, run } = useAction(state.reload);
  const locked = busy !== null || bulkBusy;

  const shown = filterKeys(rows, search);
  const selectedIds = visibleSelectedIds(shown, selected);

  async function bulkAction(action: "revoke" | "delete") {
    if (locked || selectedIds.length === 0) return;
    const msg =
      action === "delete"
        ? `Delete ${selectedIds.length} selected API key${selectedIds.length === 1 ? "" : "s"} permanently?`
        : `Revoke ${selectedIds.length} selected API key${selectedIds.length === 1 ? "" : "s"}?`;
    if (!window.confirm(msg)) return;
    setBulkBusy(true);
    let ok = 0;
    let failed = 0;
    try {
      for (const id of selectedIds) {
        try {
          if (action === "delete") await api.delete(`/api/keys/${encodeURIComponent(id)}`);
          else await api.post(`/api/keys/${encodeURIComponent(id)}/revoke`);
          ok += 1;
        } catch {
          failed += 1;
        }
      }
      if (failed === 0) toast.success(`Bulk ${action}: ${ok}/${selectedIds.length} succeeded`);
      else toast.warning(`Bulk ${action}: ${ok} succeeded, ${failed} failed`);
      if (action === "delete") setSelected(new Set());
    } finally {
      setBulkBusy(false);
      state.reload();
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const made = await run("create", () => api.post<{ key: string; name: string }>("/api/keys", { name: name.trim() }));
    if (made) {
      setCreating(false);
      setSecret({ title: `New key “${made.name}”`, key: made.key });
      setName("");
      toast.success(`Created API key “${made.name}”`);
    }
  }

  return (
    <div className="page">
      <div className="section-head" style={{ marginBottom: 16 }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>{t("API Keys")}</h1>
          <p className="muted" style={{ margin: 0 }}>{tr("Keys that clients present as")}<code>Authorization: Bearer …</code> on <code>/v1</code>{tr(". Only a prefix is ever shown after creation.")}</p>
        </div>
        <button type="button" className="btn-add" onClick={() => setCreating(true)}>
          <Plus size={14} />
          <span>{t("Create key")}</span>
        </button>
      </div>

      {secret && <SecretBanner title={secret.title} secret={secret.key} onDismiss={() => setSecret(null)} />}

      <Modal
        open={creating}
        onOpenChange={(open) => {
          setCreating(open);
          if (!open) setName("");
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
            <button type="button" className="btn-ghost" onClick={() => setCreating(false)}>
              {t("Cancel")}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        title={tr("Edit API key — {0}", {0: String(editing?.name ?? "")})}
        description={tr("Configure rate limits and optional model restrictions for this key.")}
      >
        {editing && (
          <KeyEditor
            row={editing}
            onSaved={() => {
              toast.success(`Updated key “${editing.name}”`);
              state.reload();
            }}
            onClose={() => setEditing(null)}
          />
        )}
      </Modal>

      <div className="toolbar"><input type="search" aria-label={t("Search keys")} placeholder={t("Search keys")} value={search} onChange={e=>{setSearch(e.target.value);setSelected(new Set());}} />{search && <button type="button" className="btn-ghost" onClick={()=>{setSearch("");setSelected(new Set());}}>{t("Clear search")}</button>}<span className="muted" role="status">{shown.length} / {rows.length}</span></div>
      {state.status === "ok" && rows.length > 0 && shown.length === 0 && <EmptyState title={t("No matching keys")} />}
      {state.status === "loading" && <LoadingState label={tr("Loading API keys")} />}
      {state.status === "error" && <p className="bad">{state.error.message}</p>}
      {state.status === "ok" && rows.length === 0 && <EmptyState title={tr("No API keys")} description={tr("Create a key to authenticate clients with this router.")}
        action={<button type="button" className="btn-add" onClick={() => setCreating(true)}>{t("Create key")}</button>} />}
      {state.status === "ok" && shown.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div className="section-head" style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
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
          </div>
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
                    <td>{r.name ?? "—"}</td>
                    <td>
                      <code>{r.prefix ?? "—"}</code>
                    </td>
                    <td className="muted">{limits || tr("unrestricted")}</td>
                    <td className="muted">{r.createdAt?.slice(0, 10) ?? "—"}</td>
                    <td className="muted">{r.lastUsedAt?.slice(0, 10) ?? tr("never")}</td>
                    <td className={active ? "ok" : "bad"}>{active ? tr("active") : tr("revoked")}</td>
                    <td className="row-actions">
                      {active && (
                        <>
                          <button type="button" className="btn-ghost" disabled={locked} onClick={() => setEditing(r)}>
                            {t("Edit")}
                          </button>
                          <button
                            type="button"
                            className="btn-ghost"
                            disabled={locked}
                            onClick={async () => {
                              const out = await run(
                                `regen-${id}`,
                                () => api.post<{ key: string }>(`/api/keys/${id}/regenerate`),
                                `Regenerate “${r.name}”? The current key stops working immediately.`,
                              );
                              if (out) {
                                setSecret({ title: `New key for “${r.name}”`, key: out.key });
                                toast.success(`Regenerated key “${r.name}”`);
                              }
                            }}
                          >
                            {t("Regenerate")}
                          </button>
                          <button
                            type="button"
                            className="btn-ghost"
                            disabled={locked}
                            onClick={async () => {
                              const out = await run(`revoke-${id}`, () => api.post(`/api/keys/${id}/revoke`), `Revoke “${r.name}”?`);
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
                          const out = await run(`delete-${id}`, () => api.delete(`/api/keys/${id}`), `Delete “${r.name}” permanently?`);
                          if (out) toast.success(`Deleted key “${r.name}”`);
                        }}
                      >
                        {t("Delete")}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const toLimit = (v: string) => (v.trim() === "" ? null : Number(v));

function KeyEditor({ row, onSaved, onClose }: { row: KeyRow; onSaved: () => void; onClose: () => void }) {
  const tr = useTranslator();
  const { t } = usePreferences();
  const [name, setName] = useState(row.name ?? "");
  const [perDay, setPerDay] = useState(row.maxRequestsPerDay ? String(row.maxRequestsPerDay) : "");
  const [perMinute, setPerMinute] = useState(row.maxRequestsPerMinute ? String(row.maxRequestsPerMinute) : "");
  const [models, setModels] = useState((row.allowedModels ?? []).join("\n"));
  const [addedModel, setAddedModel] = useState("");
  const { busy, error, run } = useAction(onSaved);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const done = await run("save", () =>
      api.patch(`/api/keys/${row.id}`, {
        name: name.trim(),
        maxRequestsPerDay: toLimit(perDay),
        maxRequestsPerMinute: toLimit(perMinute),
        allowedModels: models.split("\n").map((m) => m.trim()).filter(Boolean),
      }),
    );
    if (done) onClose();
  }

  return (
    <form className="stack-form" onSubmit={save}>
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
        <button type="button" className="btn-ghost" onClick={onClose}>
          {t("Cancel")}
        </button>
      </div>
    </form>
  );
}

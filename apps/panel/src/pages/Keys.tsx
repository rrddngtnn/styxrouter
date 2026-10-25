import { useState } from "react";
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
  const state = useFetch<{ keys?: KeyRow[] }>("/api/keys");
  const rows = state.status === "ok" ? state.data.keys ?? [] : [];
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<KeyRow | null>(null);
  const [secret, setSecret] = useState<{ title: string; key: string } | null>(null);
  const { busy, error, run } = useAction(state.reload);

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
          <h1 style={{ marginBottom: 4 }}>API Keys</h1>
          <p className="muted" style={{ margin: 0 }}>
            Keys that clients present as <code>Authorization: Bearer …</code> on <code>/v1</code>. Only a prefix is ever shown after creation.
          </p>
        </div>
        <button type="button" className="btn-add" onClick={() => setCreating(true)}>
          <Plus size={14} />
          <span>Create key</span>
        </button>
      </div>

      {secret && <SecretBanner title={secret.title} secret={secret.key} onDismiss={() => setSecret(null)} />}

      <Modal
        open={creating}
        onOpenChange={(open) => {
          setCreating(open);
          if (!open) setName("");
        }}
        title="Create API key"
        description="Issue a new Bearer token for inference clients (/v1/chat/completions, /v1/messages, /v1/responses)."
      >
        <form className="stack-form" onSubmit={create}>
          <label>
            Key name
            <input
              type="text"
              placeholder="e.g. laptop, cursor-workstation, ci"
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
              Cancel
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        title={`Edit API key — ${editing?.name ?? ""}`}
        description="Configure rate limits and optional model restrictions for this key."
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

      {state.status === "loading" && <LoadingState label="Loading API keys" />}
      {state.status === "error" && <p className="bad">{state.error.message}</p>}
      {state.status === "ok" && rows.length === 0 && <EmptyState title="No API keys" description="Create a key to authenticate clients with this router."
        action={<button type="button" className="btn-add" onClick={() => setCreating(true)}>Create key</button>} />}
      {state.status === "ok" && rows.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Prefix</th>
                <th>Limits</th>
                <th>Created</th>
                <th>Last used</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
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
                    <td>{r.name ?? "—"}</td>
                    <td>
                      <code>{r.prefix ?? "—"}</code>
                    </td>
                    <td className="muted">{limits || "unrestricted"}</td>
                    <td className="muted">{r.createdAt?.slice(0, 10) ?? "—"}</td>
                    <td className="muted">{r.lastUsedAt?.slice(0, 10) ?? "never"}</td>
                    <td className={active ? "ok" : "bad"}>{active ? "active" : "revoked"}</td>
                    <td className="row-actions">
                      {active && (
                        <>
                          <button type="button" className="btn-ghost" disabled={busy !== null} onClick={() => setEditing(r)}>
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn-ghost"
                            disabled={busy !== null}
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
                            Regenerate
                          </button>
                          <button
                            type="button"
                            className="btn-ghost"
                            disabled={busy !== null}
                            onClick={async () => {
                              const out = await run(`revoke-${id}`, () => api.post(`/api/keys/${id}/revoke`), `Revoke “${r.name}”?`);
                              if (out) toast.success(`Revoked key “${r.name}”`);
                            }}
                          >
                            Revoke
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        className="btn-danger"
                        disabled={busy !== null}
                        onClick={async () => {
                          const out = await run(`delete-${id}`, () => api.delete(`/api/keys/${id}`), `Delete “${r.name}” permanently?`);
                          if (out) toast.success(`Deleted key “${r.name}”`);
                        }}
                      >
                        Delete
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
        Name
        <input type="text" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} required />
      </label>
      <div className="two-col" style={{ gap: 12 }}>
        <label>
          Max requests / day
          <input type="number" min={1} step={1} placeholder="unlimited" value={perDay} onChange={(e) => setPerDay(e.target.value)} />
        </label>
        <label>
          Max requests / minute
          <input type="number" min={1} step={1} placeholder="unlimited" value={perMinute} onChange={(e) => setPerMinute(e.target.value)} />
        </label>
      </div>
      <div className="inline-form" style={{ alignItems: "start" }}>
        <ModelPicker label="Find allowed model" value={addedModel} onChange={setAddedModel} onKeyDown={(event) => {
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
        }}>Add model</button>
      </div>
      <label>
        Allowed models (one per line, empty = all models)
        <textarea rows={4} placeholder={"antigravity/gemini-4-argon-high\nglm/glm-5.3-flash"} value={models} onChange={(e) => setModels(e.target.value)} />
      </label>
      {error && <p className="bad">{error}</p>}
      <div className="row-actions">
        <button type="submit" className="btn-add" disabled={busy !== null || !name.trim()}>
          {busy ? "…" : "Save changes"}
        </button>
        <button type="button" className="btn-ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}

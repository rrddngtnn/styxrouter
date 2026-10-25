import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { appendModelLine } from "../lib/model-selection.ts";
import { api } from "../lib/api.ts";
import { Modal, useAction } from "../lib/actions.tsx";
import { EmptyState, LoadingState } from "../components/PageStates.tsx";
import { ModelPicker } from "../components/ModelPicker.tsx";
import { useFetch } from "../lib/useFetch.ts";

type Step = string | { id?: string; model?: string; comboName?: string; name?: string; [k: string]: unknown };

const stepLabel = (s: Step) => (typeof s === "string" ? s : String(s.model ?? s.comboName ?? s.name ?? s.id ?? "step"));

interface ComboRow {
  id: string;
  name?: string;
  strategy?: string;
  steps?: number;
  models?: Step[];
  enabled?: boolean;
}

export function Routing() {
  const state = useFetch<{ combos?: ComboRow[] }>("/api/routing/combos");
  const rows = state.status === "ok" ? state.data.combos ?? [] : [];
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [models, setModels] = useState("");
  const [addedModel, setAddedModel] = useState("");
  const [editing, setEditing] = useState<ComboRow | null>(null);
  const { busy, error, run } = useAction(state.reload);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const list = models.split("\n").map((m) => m.trim()).filter(Boolean);
    const made = await run("create", () => api.post("/api/routing/combos", { name: name.trim(), models: list }));
    if (made) {
      toast.success(`Created combo “${name.trim()}”`);
      setName("");
      setModels("");
      setAddedModel("");
      setCreating(false);
    }
  }

  function move(index: number, delta: -1 | 1) {
    const ids = rows.map((r) => r.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    return run("reorder", () => api.post("/api/routing/combos/reorder", { comboIds: ids }));
  }

  return (
    <div className="page">
      <div className="section-head" style={{ marginBottom: 16 }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>Routing Combos</h1>
          <p className="muted" style={{ margin: 0 }}>
            A combo is a named fallback chain of models tried in order; clients call it by name as the model ID.
          </p>
        </div>
        <button type="button" className="btn-add" onClick={() => setCreating(true)}>
          <Plus size={14} />
          <span>New combo</span>
        </button>
      </div>

      <Modal
        open={creating}
        onOpenChange={(open) => {
          setCreating(open);
          if (!open) {
            setName("");
            setModels("");
            setAddedModel("");
          }
        }}
        title="Create routing combo"
        description="Define a virtual model name and the ordered list of provider/model targets to try on fallback."
      >
        <form className="stack-form" onSubmit={create}>
          <label>
            Combo name
            <input
              type="text"
              placeholder="e.g. coding-primary, fast-fallback"
              value={name}
              maxLength={100}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              required
            />
          </label>
          <div className="inline-form" style={{ alignItems: "start" }}>
            <ModelPicker label="Find target model" value={addedModel} onChange={setAddedModel} onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (addedModel.trim()) {
                  setModels((current) => appendModelLine(current, addedModel));
                  setAddedModel("");
                }
              }
            }} />
            <button type="button" className="btn-ghost" disabled={!addedModel.trim()} onClick={() => {
              setModels((current) => appendModelLine(current, addedModel));
              setAddedModel("");
            }}>Add target</button>
          </div>
          <label>
            Target models (one per line, in fallback order)
            <textarea
              placeholder={"antigravity/gemini-4-argon-high\ncodex/gpt-5.3-codex\nglm/glm-5.3"}
              rows={5}
              value={models}
              onChange={(e) => setModels(e.target.value)}
              required
            />
          </label>
          {error && <p className="bad">{error}</p>}
          <div className="row-actions">
            <button type="submit" className="btn-add" disabled={busy !== null || !name.trim() || !models.trim()}>
              {busy === "create" ? "…" : "Create combo"}
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
        title={`Edit combo steps — ${editing?.name ?? ""}`}
        description="Reorder, remove, or append fallback targets for this combo."
        maxWidth="560px"
      >
        {editing && (
          <StepsEditor
            row={editing}
            onSaved={() => {
              toast.success(`Updated combo “${editing.name}”`);
              state.reload();
            }}
            onClose={() => setEditing(null)}
          />
        )}
      </Modal>

      {state.status === "loading" && <LoadingState label="Loading routing combos" />}
      {state.status === "error" && <p className="bad">{state.error.message}</p>}
      {state.status === "ok" && rows.length === 0 && <EmptyState title="No routing combos" description="Create an ordered fallback chain for clients to call by name."
        action={<button type="button" className="btn-add" onClick={() => setCreating(true)}>New combo</button>} />}
      {state.status === "ok" && rows.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Strategy</th>
                <th>Chain</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id}>
                  <td>
                    <code>{r.name ?? "—"}</code>
                  </td>
                  <td className="muted">{r.strategy ?? "priority"}</td>
                  <td>
                    <span className="tab-count">{r.steps ?? 0} steps</span>{" "}
                    <span className="muted" style={{ fontSize: 12 }}>
                      {(r.models ?? []).slice(0, 3).map(stepLabel).join(" → ")}
                      {(r.models?.length ?? 0) > 3 ? " …" : ""}
                    </span>
                  </td>
                  <td className={r.enabled ? "ok" : "muted"}>{r.enabled ? "enabled" : "disabled"}</td>
                  <td className="row-actions">
                    <button type="button" className="btn-ghost" disabled={busy !== null || i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                      ↑
                    </button>
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={busy !== null || i === rows.length - 1}
                      onClick={() => move(i, 1)}
                      aria-label="Move down"
                    >
                      ↓
                    </button>
                    <button type="button" className="btn-ghost" disabled={busy !== null} onClick={() => setEditing(r)}>
                      Edit steps
                    </button>
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={busy !== null}
                      onClick={() => run(`toggle-${r.id}`, () => api.put(`/api/routing/combos/${r.id}`, { isActive: !r.enabled }))}
                    >
                      {r.enabled ? "Disable" : "Enable"}
                    </button>
                    <button
                      type="button"
                      className="btn-danger"
                      disabled={busy !== null}
                      onClick={async () => {
                        const out = await run(`delete-${r.id}`, () => api.delete(`/api/routing/combos/${r.id}`), `Delete combo “${r.name}”?`);
                        if (out) toast.success(`Deleted combo “${r.name}”`);
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StepsEditor({ row, onSaved, onClose }: { row: ComboRow; onSaved: () => void; onClose: () => void }) {
  const [steps, setSteps] = useState<Step[]>(row.models ?? []);
  const [added, setAdded] = useState("");
  const { busy, error, run } = useAction(onSaved);

  const move = (i: number, d: -1 | 1) =>
    setSteps((cur) => {
      const next = [...cur];
      [next[i], next[i + d]] = [next[i + d], next[i]];
      return next;
    });
  const add = () => {
    const m = added.trim();
    if (!m) return;
    setSteps((cur) => [...cur, m]);
    setAdded("");
  };

  async function save() {
    const done = await run("save", () => api.put(`/api/routing/combos/${row.id}`, { models: steps as never }));
    if (done) onClose();
  }

  return (
    <div className="stack-form" style={{ maxWidth: "100%" }}>
      <ol className="step-list">
        {steps.map((s, i) => (
          <li key={`${i}-${stepLabel(s)}`}>
            <code>{stepLabel(s)}</code>
            <span className="row-actions">
              <button type="button" className="btn-ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move step up">
                ↑
              </button>
              <button type="button" className="btn-ghost" disabled={i === steps.length - 1} onClick={() => move(i, 1)} aria-label="Move step down">
                ↓
              </button>
              <button type="button" className="btn-danger" disabled={steps.length === 1} onClick={() => setSteps((cur) => cur.filter((_, j) => j !== i))}>
                Remove
              </button>
            </span>
          </li>
        ))}
      </ol>
      <div className="inline-form" style={{ maxWidth: "100%" }}>
        <ModelPicker
          label="Add fallback target"
          value={added}
          onChange={setAdded}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" className="btn-ghost" disabled={!added.trim()} onClick={add}>
          Add step
        </button>
      </div>
      {error && <p className="bad">{error}</p>}
      <div className="row-actions">
        <button type="button" className="btn-add" disabled={busy !== null || steps.length === 0} onClick={save}>
          {busy ? "…" : "Save steps"}
        </button>
        <button type="button" className="btn-ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

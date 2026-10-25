import { Fragment, useState } from "react";
import { api } from "../lib/api.ts";
import { useAction } from "../lib/actions.tsx";
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
  const [name, setName] = useState("");
  const [models, setModels] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const { busy, error, run } = useAction(state.reload);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const list = models.split("\n").map((m) => m.trim()).filter(Boolean);
    const made = await run("create", () => api.post("/api/routing/combos", { name: name.trim(), models: list }));
    if (made) {
      setName("");
      setModels("");
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
      <h1>Routing</h1>
      <p className="muted">
        A combo is a named list of models tried in order; clients call it by name as the model.
      </p>

      <form className="stack-form" onSubmit={create}>
        <input
          type="text"
          placeholder="Combo name"
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <textarea
          placeholder={"One model per line, in fallback order\nprovider/model-id"}
          rows={3}
          value={models}
          onChange={(e) => setModels(e.target.value)}
          required
        />
        <div>
          <button type="submit" className="btn-add" disabled={busy !== null || !name.trim() || !models.trim()}>
            {busy === "create" ? "…" : "Create combo"}
          </button>
        </div>
      </form>
      {error && <p className="bad">{error}</p>}

      {state.status === "loading" && <p>Loading…</p>}
      {state.status === "error" && <p className="bad">{state.error.message}</p>}
      {state.status === "ok" && rows.length === 0 && <p className="muted">No combos configured.</p>}
      {state.status === "ok" && rows.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Strategy</th>
              <th>Steps</th>
              <th>Enabled</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <Fragment key={r.id}>
              <tr>
                <td>{r.name ?? "—"}</td>
                <td>{r.strategy ?? "—"}</td>
                <td>{r.steps ?? 0}</td>
                <td className={r.enabled ? "ok" : "bad"}>{r.enabled ? "yes" : "no"}</td>
                <td className="row-actions">
                  <button type="button" className="btn-ghost" disabled={busy !== null || i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button>
                  <button type="button" className="btn-ghost" disabled={busy !== null || i === rows.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button>
                  <button type="button" className="btn-ghost" disabled={busy !== null} onClick={() => setEditing(editing === r.id ? null : r.id)}>
                    {editing === r.id ? "Close" : "Edit steps"}
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
                    onClick={() => run(`delete-${r.id}`, () => api.delete(`/api/routing/combos/${r.id}`), `Delete combo “${r.name}”?`)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
              {editing === r.id && (
                <tr>
                  <td colSpan={5}>
                    <StepsEditor row={r} onSaved={state.reload} onClose={() => setEditing(null)} />
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Reorder, remove or append steps. Existing steps are sent back untouched (they pin a provider connection). */
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
    <div className="editor">
      <ol className="step-list">
        {steps.map((s, i) => (
          <li key={`${i}-${stepLabel(s)}`}>
            <code>{stepLabel(s)}</code>
            <span className="row-actions">
              <button type="button" className="btn-ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move step up">up</button>
              <button type="button" className="btn-ghost" disabled={i === steps.length - 1} onClick={() => move(i, 1)} aria-label="Move step down">down</button>
              <button type="button" className="btn-danger" disabled={steps.length === 1} onClick={() => setSteps((cur) => cur.filter((_, j) => j !== i))}>Remove</button>
            </span>
          </li>
        ))}
      </ol>
      <div className="inline-form">
        <input type="text" placeholder="provider/model-id or another combo's name" value={added} onChange={(e) => setAdded(e.target.value)} />
        <button type="button" className="btn-ghost" disabled={!added.trim()} onClick={add}>Add step</button>
      </div>
      {error && <p className="bad">{error}</p>}
      <div className="row-actions">
        <button type="button" className="btn-add" disabled={busy !== null || steps.length === 0} onClick={save}>{busy ? "..." : "Save steps"}</button>
        <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

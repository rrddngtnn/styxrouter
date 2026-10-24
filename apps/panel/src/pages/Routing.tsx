import { useState } from "react";
import { api } from "../lib/api.ts";
import { useAction } from "../lib/actions.tsx";
import { useFetch } from "../lib/useFetch.ts";

interface ComboRow {
  id: string;
  name?: string;
  strategy?: string;
  steps?: number;
  enabled?: boolean;
}

export function Routing() {
  const state = useFetch<{ combos?: ComboRow[] }>("/api/routing/combos");
  const rows = state.status === "ok" ? state.data.combos ?? [] : [];
  const [name, setName] = useState("");
  const [models, setModels] = useState("");
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
              <tr key={r.id}>
                <td>{r.name ?? "—"}</td>
                <td>{r.strategy ?? "—"}</td>
                <td>{r.steps ?? 0}</td>
                <td className={r.enabled ? "ok" : "bad"}>{r.enabled ? "yes" : "no"}</td>
                <td className="row-actions">
                  <button type="button" className="btn-ghost" disabled={busy !== null || i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button>
                  <button type="button" className="btn-ghost" disabled={busy !== null || i === rows.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button>
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
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

import { useTranslator } from "../lib/useTranslator.ts";
import { useState } from "react";
import { usePreferences } from "../lib/preferences.tsx";
import { filterCombos, visibleSelectedIds } from "../lib/table-search.ts";
import { Play, Plus } from "lucide-react";
import { toast } from "sonner";
import { appendModelLine } from "../lib/model-selection.ts";
import { api } from "../lib/api.ts";
import { Modal, useAction } from "../lib/actions.tsx";
import { EmptyState, LoadingState } from "../components/PageStates.tsx";
import { TableScroll } from "../components/TableScroll.tsx";
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

interface DryRunCandidate {
  id: string;
  name: string | null;
  eligible: boolean;
  reason: string;
  tags: string[];
  priority: number | null;
}

interface DryRunSimulationResult {
  target: string;
  isCombo: boolean;
  strategy: string;
  winner: {
    stepIndex: number;
    rawTarget: string;
    provider: string;
    model: string;
    accountId: string;
    accountName: string | null;
  } | null;
  steps: Array<{
    stepIndex: number;
    rawTarget: string;
    provider: string;
    model: string;
    eligibleCount: number;
    selectedAccountId: string | null;
    selectedAccountName: string | null;
    candidates: DryRunCandidate[];
  }>;
}

export function Routing() {
  const tr = useTranslator();
  const {t} = usePreferences();
  const [search, setSearch] = useState("");
  const state = useFetch<{ combos?: ComboRow[] }>("/api/routing/combos");
  const rows = state.status === "ok" ? state.data.combos ?? [] : [];
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [models, setModels] = useState("");
  const [addedModel, setAddedModel] = useState("");
  const [editing, setEditing] = useState<ComboRow | null>(null);
  const [dryRunResult, setDryRunResult] = useState<DryRunSimulationResult | null>(null);
  const [dryRunBusy, setDryRunBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const { busy, error, run } = useAction(state.reload);
  const locked = busy !== null || bulkBusy;

  const shown = filterCombos(rows, search);
  const selectedIds = visibleSelectedIds(shown, selected);

  async function bulkAction(action: "enable" | "disable" | "delete") {
    if (locked || selectedIds.length === 0) return;
    if (
      action === "delete" &&
      !window.confirm(`Delete ${selectedIds.length} selected combo${selectedIds.length === 1 ? "" : "s"} permanently?`)
    ) {
      return;
    }
    setBulkBusy(true);
    let ok = 0;
    let failed = 0;
    try {
      for (const id of selectedIds) {
        try {
          if (action === "delete") await api.delete(`/api/routing/combos/${encodeURIComponent(id)}`);
          else await api.put(`/api/routing/combos/${encodeURIComponent(id)}`, { isActive: action === "enable" });
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

  async function simulateCombo(comboName: string) {
    setDryRunBusy(comboName);
    try {
      const res = await api.post<DryRunSimulationResult>("/api/routing/dry-run", { target: comboName });
      setDryRunResult(res);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setDryRunBusy(null);
    }
  }

  return (
    <div className="page">
      <div className="section-head" style={{ marginBottom: 16 }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>{t("Routing Combos")}</h1>
          <p className="muted" style={{ margin: 0 }}>{tr("A combo is a named fallback chain of models tried in order; clients call it by name as the model ID.")}</p>
        </div>
        <button type="button" className="btn-add" onClick={() => setCreating(true)}>
          <Plus size={14} />
          <span>{t("New combo")}</span>
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
        title={tr("Create routing combo")}
        description={tr("Define a virtual model name and the ordered list of provider/model targets to try on fallback.")}
      >
        <form className="stack-form" onSubmit={create}>
          <label>{tr("Combo name")}<input
              type="text"
              placeholder={tr("e.g. coding-primary, fast-fallback")}
              value={name}
              maxLength={100}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              required
            />
          </label>
          <div className="inline-form" style={{ alignItems: "start" }}>
            <ModelPicker label={tr("Find target model")} value={addedModel} onChange={setAddedModel} onKeyDown={(event) => {
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
            }}>{t("Add target")}</button>
          </div>
          <label>{tr("Target models (one per line, in fallback order)")}<textarea
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
              {busy === "create" ? "…" : tr("Create combo")}
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
        title={tr("Edit combo steps — {0}", {0: String(editing?.name ?? "")})}
        description={tr("Reorder, remove, or append fallback targets for this combo.")}
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

      <div className="toolbar"><input type="search" aria-label={t("Search routing combos")} placeholder={t("Search routing combos")} value={search} onChange={e=>{setSearch(e.target.value);setSelected(new Set());}} />{search && <button type="button" className="btn-ghost" onClick={()=>{setSearch("");setSelected(new Set());}}>{t("Clear search")}</button>}<span className="muted" role="status">{shown.length} / {rows.length}</span></div>
      {state.status === "ok" && rows.length > 0 && shown.length === 0 && <EmptyState title={t("No matching combos")} />}
      {state.status === "loading" && <LoadingState label={tr("Loading routing combos")} />}
      {state.status === "error" && <p className="bad">{state.error.message}</p>}
      {state.status === "ok" && rows.length === 0 && <EmptyState title={tr("No routing combos")} description={tr("Create an ordered fallback chain for clients to call by name.")}
        action={<button type="button" className="btn-add" onClick={() => setCreating(true)}>{t("New combo")}</button>} />}
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
                  setSelected(checked ? new Set(shown.map((r) => r.id)) : new Set());
                }}
              />
              {t("Select all filtered")} ({selectedIds.length}/{shown.length})
            </label>
            <div className="row-actions">
              <button
                type="button"
                className="btn-ghost"
                disabled={locked || selectedIds.length === 0}
                onClick={() => void bulkAction("enable")}
              >
                {t("Enable selected")}
              </button>
              <button
                type="button"
                className="btn-ghost"
                disabled={locked || selectedIds.length === 0}
                onClick={() => void bulkAction("disable")}
              >
                {t("Disable selected")}
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
          <TableScroll label={t("Routing combos table")} stickySelection>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 36 }} />
                <th>{t("Name")}</th>
                <th>{t("Strategy")}</th>
                <th>{t("Chain")}</th>
                <th>{t("Status")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => { const i = rows.indexOf(r); return (
                <tr key={r.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={tr("Select {0}", {0: String(r.name ?? r.id)})}
                      disabled={locked}
                      checked={selected.has(r.id)}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setSelected((s) => {
                          const next = new Set(s);
                          if (checked) next.add(r.id);
                          else next.delete(r.id);
                          return next;
                        });
                      }}
                    />
                  </td>
                  <td>
                    <code className="table-identity">{r.name ?? "—"}</code>
                  </td>
                  <td className="muted">{r.strategy ?? "priority"}</td>
                  <td>
                    <span className="tab-count">{r.steps ?? 0} steps</span>{" "}
                    <span className="muted" style={{ fontSize: 14 }}>
                      {(r.models ?? []).slice(0, 3).map(stepLabel).join(" → ")}
                      {(r.models?.length ?? 0) > 3 ? " …" : ""}
                    </span>
                  </td>
                  <td className={r.enabled ? "ok" : "muted"}>{r.enabled ? tr("enabled") : tr("disabled")}</td>
                  <td className="row-actions">
                    <button type="button" className="btn-ghost" disabled={locked || rows.indexOf(r) === 0} onClick={() => move(i, -1)} aria-label={tr("Move up")}>
                      ↑
                    </button>
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={locked || rows.indexOf(r) === rows.length - 1}
                      onClick={() => move(i, 1)}
                      aria-label={tr("Move down")}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={locked || dryRunBusy !== null || !r.name}
                      onClick={() => r.name && void simulateCombo(r.name)}
                    >
                      <Play size={13} />
                      <span>{dryRunBusy === r.name ? "…" : tr("Dry run")}</span>
                    </button>
                    <button type="button" className="btn-ghost" disabled={locked} onClick={() => setEditing(r)}>
                      {t("Edit steps")}
                    </button>
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={locked}
                      onClick={() => run(`toggle-${r.id}`, () => api.put(`/api/routing/combos/${r.id}`, { isActive: !r.enabled }))}
                    >
                      {r.enabled ? tr("Disable") : tr("Enable")}
                    </button>
                    <button
                      type="button"
                      className="btn-danger"
                      disabled={locked}
                      onClick={async () => {
                        const out = await run(`delete-${r.id}`, () => api.delete(`/api/routing/combos/${r.id}`), `Delete combo “${r.name}”?`);
                        if (out) toast.success(`Deleted combo “${r.name}”`);
                      }}
                    >
                      {t("Delete")}
                    </button>
                  </td>
                </tr>
              );})}
            </tbody>
          </table>
          </TableScroll>
        </div>
      )}

      <Modal
        open={dryRunResult !== null}
        onOpenChange={(open) => {
          if (!open) setDryRunResult(null);
        }}
        title={tr("Routing dry-run — {0}", {0: String(dryRunResult?.target ?? "")})}
        description={tr("Simulated candidate evaluation without contacting upstream providers.")}
        maxWidth="640px"
      >
        {dryRunResult && (
          <div className="stack-form" style={{ maxWidth: "100%" }}>
            {dryRunResult.winner ? (
              <div className="card" style={{ padding: 12 }}>
                <strong className="ok">{tr("Selected winner")}</strong>
                <div style={{ marginTop: 4, fontSize: 14 }}>
                  {tr("Step")} #{dryRunResult.winner.stepIndex}:{" "}
                  <code>{dryRunResult.winner.provider}/{dryRunResult.winner.model}</code> →{" "}
                  <strong>{dryRunResult.winner.accountName ?? dryRunResult.winner.accountId.slice(0, 8)}</strong>
                </div>
              </div>
            ) : (
              <div className="card" style={{ padding: 12 }}>
                <strong className="bad">{tr("No eligible upstream account available")}</strong>
                <p className="muted" style={{ margin: "4px 0 0 0", fontSize: 14 }}>
                  {tr("Every step in this combo currently has zero eligible accounts.")}
                </p>
              </div>
            )}

            <div style={{ display: "grid", gap: 10, maxHeight: 360, overflowY: "auto" }}>
              {dryRunResult.steps.map((s) => (
                <div key={s.stepIndex} className="card" style={{ padding: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
                    <strong>
                      {tr("Step")} #{s.stepIndex}: <code>{s.rawTarget}</code>
                    </strong>
                    <span className={s.eligibleCount > 0 ? "ok" : "bad"}>
                      {s.eligibleCount} {tr("eligible")} / {s.candidates.length} {tr("total")}
                    </span>
                  </div>
                  {s.candidates.length === 0 ? (
                    <p className="muted" style={{ margin: 0, fontSize: 14 }}>{tr("No connected accounts for provider")} <code>{s.provider}</code>.</p>
                  ) : (
                    <div style={{ display: "grid", gap: 4, fontSize: 14 }}>
                      {s.candidates.map((c) => (
                        <div key={c.id} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                          <span>
                            <strong>{c.name ?? c.id.slice(0, 8)}</strong>
                            {c.tags.length > 0 ? ` (${c.tags.join(", ")})` : ""}
                          </span>
                          <span className={c.eligible ? "ok" : "muted"}>{c.reason}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="row-actions">
              <button type="button" className="btn-ghost" onClick={() => setDryRunResult(null)}>
                {t("Close")}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function StepsEditor({ row, onSaved, onClose }: { row: ComboRow; onSaved: () => void; onClose: () => void }) {
  const tr = useTranslator();
  const { t } = usePreferences();
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
              <button type="button" className="btn-ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label={tr("Move step up")}>
                ↑
              </button>
              <button type="button" className="btn-ghost" disabled={i === steps.length - 1} onClick={() => move(i, 1)} aria-label={tr("Move step down")}>
                ↓
              </button>
              <button type="button" className="btn-danger" disabled={steps.length === 1} onClick={() => setSteps((cur) => cur.filter((_, j) => j !== i))}>
                {t("Remove")}
              </button>
            </span>
          </li>
        ))}
      </ol>
      <div className="inline-form" style={{ maxWidth: "100%" }}>
        <ModelPicker
          label={tr("Add fallback target")}
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
          {t("Add step")}
        </button>
      </div>
      {error && <p className="bad">{error}</p>}
      <div className="row-actions">
        <button type="button" className="btn-add" disabled={busy !== null || steps.length === 0} onClick={save}>
          {busy ? "…" : "Save steps"}
        </button>
        <button type="button" className="btn-ghost" onClick={onClose}>
          {t("Cancel")}
        </button>
      </div>
    </div>
  );
}

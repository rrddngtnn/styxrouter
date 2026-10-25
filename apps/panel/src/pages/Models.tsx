import { useEffect, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api.ts";
import { Modal } from "../lib/actions.tsx";

type Capability = "supportsThinking" | "supportsVision" | "supportsTools";
interface ModelMetadata {
  provider: string;
  modelId: string;
  contextWindow: number;
  supportsThinking: boolean;
  supportsVision: boolean;
  supportsTools: boolean;
  overrides: { contextWindow: number | null } & Record<Capability, boolean | null>;
}
interface CatalogModel {
  id: string;
  owned_by: string;
}
const capabilities = [
  ["supportsThinking", "Reasoning"],
  ["supportsVision", "Vision"],
  ["supportsTools", "Tools"],
] as const;

export function ModelEditor({
  model,
  onSaved,
  onClose,
}: {
  model: ModelMetadata;
  onSaved: (model: ModelMetadata) => void;
  onClose?: () => void;
}) {
  const [context, setContext] = useState(String(model.overrides.contextWindow ?? model.contextWindow));
  const [values, setValues] = useState(model.overrides);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function save() {
    const tokens = context === "" ? null : Number(context);
    if (tokens !== null && (!Number.isSafeInteger(tokens) || tokens <= 0)) {
      setMessage("Enter a positive whole token count, or leave blank for automatic.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const result = await api.patch<{ model: ModelMetadata }>("/api/model-metadata", {
        provider: model.provider,
        modelId: model.modelId,
        contextWindow: tokens,
        ...Object.fromEntries(capabilities.map(([key]) => [key, values[key]])),
      });
      setValues(result.model.overrides);
      onSaved(result.model);
      setMessage("Saved. Runtime and catalog capabilities updated.");
      toast.success(`Updated metadata for ${model.provider}/${model.modelId}`);
      onClose?.();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setMessage(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="model-editor stack-form"
      style={{ maxWidth: "100%" }}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <h2 style={{ margin: "0 0 4px", fontSize: 15 }}>
        <code>
          {model.provider}/{model.modelId}
        </code>
      </h2>
      <label>
        Context window (tokens)
        <input
          type="number"
          min="1"
          step="1"
          value={context}
          placeholder="Automatic"
          onChange={(event) => setContext(event.target.value)}
        />
      </label>
      <div className="model-actions">
        <button type="button" className="btn-ghost" onClick={() => setContext("1000000")}>
          Default 1M
        </button>
        <button type="button" className="btn-ghost" onClick={() => setContext("256000")}>
          GPT 256K
        </button>
        <button type="button" className="btn-ghost" onClick={() => setContext("")}>
          Automatic context
        </button>
      </div>
      <p className="muted" style={{ margin: "2px 0 6px" }}>
        Effective context: {model.contextWindow.toLocaleString()} tokens. Blank clears the manual override. Unknown contexts default to 1M; use GPT 256K for GPT models.
      </p>
      {capabilities.map(([key, label]) => (
        <label key={key}>
          {label}
          <select
            value={values[key] === null ? "auto" : String(values[key])}
            onChange={(event) =>
              setValues((previous) => ({
                ...previous,
                [key]: event.target.value === "auto" ? null : event.target.value === "true",
              }))
            }
          >
            <option value="auto">Automatic ({model[key] ? "enabled" : "disabled"})</option>
            <option value="true">Enabled</option>
            <option value="false">Disabled</option>
          </select>
        </label>
      ))}
      <div className="row-actions" style={{ marginTop: 8 }}>
        <button type="submit" className="btn-add" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
        {onClose && (
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
        )}
      </div>
      {message && <p role="status">{message}</p>}
    </form>
  );
}

export function Models() {
  const [catalog, setCatalog] = useState<CatalogModel[]>([]);
  const [filter, setFilter] = useState("");
  const [provider, setProvider] = useState("");
  const [modelId, setModelId] = useState("");
  const [model, setModel] = useState<ModelMetadata | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api
      .get<{ data: CatalogModel[] }>("/v1/models?configuredOnly=true&prefix=canonical")
      .then((result) => setCatalog(result.data.filter((row) => row.owned_by !== "combo")))
      .catch((err) => setError(String(err)));
  }, []);

  async function openModel(prov: string, id: string) {
    setProvider(prov);
    setModelId(id);
    setLoading(true);
    setError("");
    try {
      const result = await api.get<{ model: ModelMetadata }>(
        `/api/model-metadata?${new URLSearchParams({ provider: prov, modelId: id })}`,
      );
      setModel(result.model);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  const filtered = filter.trim()
    ? catalog.filter((r) => `${r.id} ${r.owned_by}`.toLowerCase().includes(filter.trim().toLowerCase()))
    : catalog;

  return (
    <section className="page">
      <h1>Model Capabilities</h1>
      <p className="muted">
        Inspect and override context window sizes, reasoning support, vision input, and tool calling per model.
      </p>

      <div className="toolbar">
        <input
          type="search"
          placeholder="Search configured models (e.g. argon, codex, glm)…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <span className="muted">{filtered.length} models</span>
      </div>

      <form
        className="card stack-form"
        style={{ maxWidth: 680, marginBottom: 20 }}
        onSubmit={(event) => {
          event.preventDefault();
          void openModel(provider, modelId);
        }}
      >
        <div className="two-col" style={{ gap: 12 }}>
          <label>
            Provider
            <input
              required
              placeholder="e.g. antigravity, codex, glm"
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
            />
          </label>
          <label>
            Model ID
            <input
              required
              placeholder="e.g. gemini-4-argon-high"
              value={modelId}
              onChange={(event) => setModelId(event.target.value)}
            />
          </label>
        </div>
        <div className="row-actions">
          <button type="submit" className="btn-add" disabled={loading || !provider.trim() || !modelId.trim()}>
            <SlidersHorizontal size={14} />
            <span>{loading ? "Loading…" : "Inspect / Override model"}</span>
          </button>
        </div>
      </form>

      {error && (
        <p role="alert" className="bad">
          {error}
        </p>
      )}

      {filtered.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Canonical ID</th>
                <th>Provider</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const bareId = row.id.includes("/") ? row.id.slice(row.id.indexOf("/") + 1) : row.id;
                return (
                  <tr key={row.id}>
                    <td>
                      <code>{row.id}</code>
                    </td>
                    <td>
                      <span className="vendor-badge">{row.owned_by}</span>
                    </td>
                    <td className="row-actions">
                      <button
                        type="button"
                        className="btn-ghost"
                        disabled={loading}
                        onClick={() => openModel(row.owned_by, bareId)}
                      >
                        Configure
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={model !== null}
        onOpenChange={(open) => {
          if (!open) setModel(null);
        }}
        title="Configure model capabilities"
        description="Override context length or capability flags advertised by /v1/models and enforced at dispatch."
      >
        {model && (
          <ModelEditor
            key={`${model.provider}/${model.modelId}`}
            model={model}
            onSaved={setModel}
            onClose={() => setModel(null)}
          />
        )}
      </Modal>
    </section>
  );
}

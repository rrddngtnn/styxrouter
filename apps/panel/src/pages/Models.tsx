import { useEffect, useMemo, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, LoadingState } from "../components/PageStates.tsx";
import { Pagination } from "../components/Pagination.tsx";
import { api } from "../lib/api.ts";
import { Modal } from "../lib/actions.tsx";
import { paginationState } from "../lib/pagination.ts";

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
export interface CatalogModel {
  id: string;
  owned_by: string;
  name?: string;
  type?: string;
  context_length?: number | null;
  thinking?: boolean;
  supportsThinking?: boolean;
  capabilities?: {
    thinking?: boolean;
    supportsThinking?: boolean;
    reasoning?: boolean;
    vision?: boolean;
    tool_calling?: boolean;
    supportsTools?: boolean;
  };
}
const capabilities = [
  ["supportsThinking", "Reasoning"],
  ["supportsVision", "Vision"],
  ["supportsTools", "Tools"],
] as const;

export function formatContextTokens(tokens?: number | null): string {
  if (!tokens || tokens <= 0) return "—";
  if (tokens >= 1000000) return `${Math.round((tokens / 1000000) * 10) / 10}M`;
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`;
  return String(tokens);
}

export function extractCatalogCapabilities(row: CatalogModel): string[] {
  const tags: string[] = [];
  const caps = row.capabilities;
  if (row.thinking || row.supportsThinking || caps?.thinking || caps?.supportsThinking || caps?.reasoning) {
    tags.push("Reasoning");
  }
  if (caps?.vision) {
    tags.push("Vision");
  }
  if (caps?.tool_calling || caps?.supportsTools) {
    tags.push("Tools");
  }
  return tags;
}

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
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [customOpen, setCustomOpen] = useState(false);
  const [provider, setProvider] = useState("");
  const [modelId, setModelId] = useState("");
  const [model, setModel] = useState<ModelMetadata | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function loadCatalog() {
    setCatalogLoading(true);
    api
      .get<{ data: CatalogModel[] }>("/v1/models?configuredOnly=true&prefix=canonical")
      .then((result) => setCatalog(result.data.filter((row) => row.owned_by !== "combo")))
      .catch((err) => setError(String(err)))
      .finally(() => setCatalogLoading(false));
  }

  useEffect(() => {
    loadCatalog();
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
      setCustomOpen(false);
      setModel(result.model);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  const providers = useMemo(
    () => [...new Set(catalog.map((r) => r.owned_by).filter(Boolean))].sort(),
    [catalog],
  );

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return catalog.filter((r) => {
      if (providerFilter !== "all" && r.owned_by !== providerFilter) return false;
      if (!q) return true;
      return `${r.id} ${r.owned_by} ${r.name ?? ""} ${r.type ?? ""}`.toLowerCase().includes(q);
    });
  }, [catalog, filter, providerFilter]);

  const pg = paginationState(filtered.length, pageSize, page);
  const pageRows = filtered.slice(Math.max(0, pg.start - 1), pg.end);

  return (
    <section className="page">
      <div className="section-head" style={{ marginBottom: 16 }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>Model Capabilities</h1>
          <p className="muted" style={{ margin: 0 }}>
            Inspect and override context window sizes, reasoning support, vision input, and tool calling per model.
          </p>
        </div>
        <button type="button" className="btn-ghost" onClick={() => setCustomOpen(true)}>
          <SlidersHorizontal size={14} />
          <span>Inspect custom model ID</span>
        </button>
      </div>

      <div className="toolbar">
        <input
          type="search"
          placeholder="Search models (e.g. argon, codex, glm, flash)…"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setPage(1);
          }}
          style={{ minWidth: 340 }}
        />
        <select
          aria-label="Filter by provider"
          value={providerFilter}
          onChange={(e) => {
            setProviderFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="all">All providers ({catalog.length})</option>
          {providers.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <span className="muted" style={{ marginLeft: "auto" }}>
          {filtered.length} {filtered.length === 1 ? "model" : "models"}
        </span>
      </div>

      {error && (
        <p role="alert" className="bad">
          {error}
        </p>
      )}

      {catalogLoading && <LoadingState label="Loading model catalog" />}

      {!catalogLoading && filtered.length === 0 && (
        <EmptyState
          title="No matching models"
          description={
            filter || providerFilter !== "all"
              ? "Try clearing your search or switching the provider filter."
              : "Connect a provider to populate the model catalog."
          }
          action={
            (filter || providerFilter !== "all") ? (
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  setFilter("");
                  setProviderFilter("all");
                  setPage(1);
                }}
              >
                Reset filters
              </button>
            ) : undefined
          }
        />
      )}

      {!catalogLoading && filtered.length > 0 && (
        <>
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Canonical ID</th>
                  <th>Provider</th>
                  <th>Type</th>
                  <th>Context</th>
                  <th>Capabilities</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => {
                  const bareId = row.id.includes("/") ? row.id.slice(row.id.indexOf("/") + 1) : row.id;
                  const tags = extractCatalogCapabilities(row);
                  return (
                    <tr key={row.id}>
                      <td>
                        <code>{row.id}</code>
                      </td>
                      <td>
                        <span className="vendor-badge">{row.owned_by}</span>
                      </td>
                      <td className="muted">{row.type ?? "chat"}</td>
                      <td>
                        <code>{formatContextTokens(row.context_length)}</code>
                      </td>
                      <td>
                        {tags.length > 0 ? (
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {tags.map((t) => (
                              <span key={t} className="vendor-badge">
                                {t}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="muted">—</span>
                        )}
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
          <Pagination
            total={filtered.length}
            page={pg.page}
            pageSize={pg.pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            pageSizeOptions={[15, 20, 50, 100]}
            itemLabel="models"
            label="Models pagination"
          />
        </>
      )}

      <Modal
        open={customOpen}
        onOpenChange={setCustomOpen}
        title="Inspect or override custom model ID"
        description="Look up any provider and model ID directly, even if it is not currently listed in the active catalog."
      >
        <form
          className="stack-form"
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
              {loading ? "Loading…" : "Inspect model"}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setCustomOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      </Modal>

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
            onSaved={(saved) => {
              setModel(saved);
              loadCatalog();
            }}
            onClose={() => setModel(null)}
          />
        )}
      </Modal>
    </section>
  );
}

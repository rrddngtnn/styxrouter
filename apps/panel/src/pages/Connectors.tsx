import { Fragment, useState } from "react";
import { api, type JsonValue } from "../lib/api.ts";
import { useAction } from "../lib/actions.tsx";
import { DASH } from "../lib/format.ts";
import { useFetch } from "../lib/useFetch.ts";

interface Node {
  id: string;
  type: string;
  name: string;
  prefix: string | null;
  apiType: string | null;
  baseUrl: string | null;
  chatPath: string | null;
  modelsPath: string | null;
  customHeaders: Record<string, string> | null;
  createdAt: string | null;
}

const API_TYPES = ["chat", "responses", "embeddings", "rerank", "audio-transcriptions", "audio-speech", "images-generations"] as const;

const blank = { type: "openai-compatible", name: "", prefix: "", apiType: "chat", baseUrl: "", chatPath: "", modelsPath: "" };

export function Connectors() {
  const state = useFetch<{ nodes?: Node[] }>("/api/provider-nodes");
  const nodes = state.status === "ok" ? state.data.nodes ?? [] : [];
  const [editing, setEditing] = useState<Node | "new" | null>(null);

  return (
    <div className="page">
      <h1>Custom connectors</h1>
      <p className="muted">
        OpenAI- or Anthropic-compatible endpoints routed through their own prefix (e.g. <code>muse/model</code>). The node
        defines where requests go; the accounts under <a href="#/providers">Providers</a> hold the keys.
      </p>
      <div className="toolbar">
        <button type="button" className="btn-ghost" onClick={state.reload}>Reload</button>
        <button type="button" className="btn-add" onClick={() => setEditing("new")}>New connector</button>
      </div>
      {state.status === "loading" && <p>Loading…</p>}
      {state.status === "error" && <p className="bad">{state.error.message}</p>}
      {state.status === "ok" && nodes.length === 0 && <p className="muted">No connectors yet.</p>}

      <table className="table fixed">
        <colgroup><col style={{ width: "16%" }} /><col style={{ width: "12%" }} /><col style={{ width: "10%" }} /><col style={{ width: "30%" }} /><col style={{ width: "12%" }} /><col /></colgroup>
        <thead><tr><th>Name</th><th>Type</th><th>Prefix</th><th>Base URL</th><th>API</th><th /></tr></thead>
        <tbody>
          {nodes.map((n) => (
            <Fragment key={n.id}>
              <tr>
                <td>{n.name}</td>
                <td>{n.type.replace("-compatible", "")}</td>
                <td><code>{n.prefix ?? DASH}</code></td>
                <td className="ellip" title={n.baseUrl ?? undefined}>{n.baseUrl ?? DASH}</td>
                <td>{n.apiType ?? DASH}</td>
                <td className="row-actions">
                  <button type="button" className="btn-ghost" onClick={() => setEditing(n)}>Edit</button>
                  <DeleteNode node={n} onGone={() => setEditing(null)} />
                </td>
              </tr>
              {editing === n && <tr><td colSpan={6}><NodeForm node={n} onDone={() => setEditing(null)} /></td></tr>}
            </Fragment>
          ))}
        </tbody>
      </table>

      {editing === "new" && (
        <section className="editor card">
          <h2>New connector</h2>
          <NodeForm onDone={() => setEditing(null)} />
        </section>
      )}
    </div>
  );
}

function DeleteNode({ node, onGone }: { node: Node; onGone: () => void }) {
  const { busy, run } = useAction(onGone);
  return (
    <button
      type="button"
      className="btn-ghost"
      disabled={busy !== null}
      onClick={() => run("del", () => api.delete(`/api/provider-nodes/${node.id}`), `Delete connector "${node.name}"? Its accounts stay but lose their route.`)}
    >
      {busy === "del" ? "…" : "Delete"}
    </button>
  );
}

function NodeForm({ node, onDone }: { node?: Node; onDone: () => void }) {
  const editing = Boolean(node);
  const [form, setForm] = useState(
    node
      ? {
          type: node.type as "openai-compatible" | "anthropic-compatible",
          name: node.name,
          prefix: node.prefix ?? "",
          apiType: node.apiType ?? "chat",
          baseUrl: node.baseUrl ?? "",
          chatPath: node.chatPath ?? "",
          modelsPath: node.modelsPath ?? "",
        }
      : { ...blank },
  );
  const { busy, error, run } = useAction(onDone);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const payload: Record<string, JsonValue> = {
      type: form.type,
      name: form.name.trim(),
      baseUrl: form.baseUrl.trim(),
      chatPath: form.chatPath.trim() || null,
      modelsPath: form.modelsPath.trim() || null,
    };
    if (form.type === "openai-compatible") payload.apiType = form.apiType;
    if (!editing) payload.prefix = form.prefix.trim();
    await run("save", () =>
      editing && node ? api.patch(`/api/provider-nodes/${node.id}`, payload) : api.post("/api/provider-nodes", payload),
    );
  }

  return (
    <form className="stack-form" onSubmit={submit}>
      <label>Name
        <input value={form.name} onChange={set("name")} required maxLength={200} />
      </label>
      <label>Wire format
        <select value={form.type} onChange={set("type")}>
          <option value="openai-compatible">OpenAI-compatible</option>
          <option value="anthropic-compatible">Anthropic-compatible</option>
        </select>
      </label>
      {!editing && (
        <label>Request prefix
          <input value={form.prefix} onChange={set("prefix")} required maxLength={100} placeholder="muse" />
        </label>
      )}
      {editing && <p className="muted">Prefix <code>{form.prefix || "—"}</code> — fixed after creation (routing history depends on it).</p>}
      {form.type === "openai-compatible" && (
        <label>API type
          <select value={form.apiType} onChange={set("apiType")}>
            {API_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
      )}
      <label>Base URL
        <input value={form.baseUrl} onChange={set("baseUrl")} required placeholder="https://bridge.example/v1" />
      </label>
      <label>Chat path override
        <input value={form.chatPath} onChange={set("chatPath")} placeholder="/chat/completions" />
      </label>
      <label>Models path override
        <input value={form.modelsPath} onChange={set("modelsPath")} placeholder="/models" />
      </label>
      {error && <div className="bad">{error}</div>}
      <div className="row-actions">
        <button type="submit" className="btn-add" disabled={busy !== null || !form.name.trim() || !form.baseUrl.trim()}>
          {busy === "save" ? "…" : editing ? "Save" : "Create"}
        </button>
        <button type="button" className="btn-ghost" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

import { useState } from "react";
import { api } from "../lib/api.ts";
import { SecretBanner, useAction } from "../lib/actions.tsx";
import { useFetch } from "../lib/useFetch.ts";

type Tool = "claude-code" | "codex" | "opencode" | "aider" | "openai" | "curl";

const TOOLS: { id: Tool; name: string }[] = [
  { id: "claude-code", name: "Claude Code" },
  { id: "codex", name: "Codex CLI" },
  { id: "opencode", name: "OpenCode" },
  { id: "aider", name: "Aider" },
  { id: "openai", name: "Cline / Continue / Roo / Kilo / Cursor" },
  { id: "curl", name: "curl test" },
];

function snippet(tool: Tool, base: string, key: string, model: string): { file?: string; body: string }[] {
  switch (tool) {
    case "claude-code":
      return [{ file: "shell", body: `export ANTHROPIC_BASE_URL="${base}"\nexport ANTHROPIC_AUTH_TOKEN="${key}"\nexport ANTHROPIC_MODEL="${model}"\nclaude` }];
    case "codex":
      return [
        { file: "~/.codex/config.toml", body: `model = "${model}"\nmodel_provider = "styx"\n\n[model_providers.styx]\nname = "StyxRouter"\nbase_url = "${base}/v1"\nenv_key = "STYX_API_KEY"\nwire_api = "responses"` },
        { file: "shell", body: `export STYX_API_KEY="${key}"\ncodex` },
      ];
    case "opencode":
      return [
        {
          file: "opencode.json",
          body: JSON.stringify(
            { $schema: "https://opencode.ai/config.json", provider: { styx: { npm: "@ai-sdk/openai-compatible", name: "StyxRouter", options: { baseURL: `${base}/v1`, apiKey: key }, models: { [model]: {} } } }, model: `styx/${model}` },
            null,
            2,
          ),
        },
      ];
    case "aider":
      return [{ file: "shell", body: `aider --openai-api-base ${base}/v1 --openai-api-key ${key} --model openai/${model}` }];
    case "openai":
      return [{ body: `Provider type : OpenAI-compatible\nBase URL      : ${base}/v1\nAPI key       : ${key}\nModel         : ${model}` }];
    case "curl":
      return [{ file: "shell", body: `curl ${base}/v1/chat/completions \\\n  -H "Authorization: Bearer ${key}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"${model}","messages":[{"role":"user","content":"Reply with the word ok."}],"max_tokens":16}'` }];
  }
}

export function Tools() {
  const [tool, setTool] = useState<Tool>("claude-code");
  const [base, setBase] = useState(() => location.origin);
  const [key, setKey] = useState("");
  const [model, setModel] = useState("");
  const [fresh, setFresh] = useState<{ title: string; key: string } | null>(null);
  const models = useFetch<{ data?: { id: string }[] }>("/v1/models");
  const ids = models.status === "ok" ? (models.data.data ?? []).map((m) => m.id) : [];
  const { busy, error, run } = useAction();

  async function makeKey() {
    const name = `${TOOLS.find((t) => t.id === tool)?.name ?? tool}`.slice(0, 40);
    const made = await run("key", () => api.post<{ key: string; name: string }>("/api/keys", { name }));
    if (made) {
      setKey(made.key);
      setFresh({ title: `New key "${made.name}"`, key: made.key });
    }
  }

  const shownKey = key.trim() || "YOUR_STYX_KEY";
  const shownModel = model || ids[0] || "MODEL_ID";

  return (
    <div className="page">
      <h1>Connect tools</h1>
      <p className="muted">
        Ready-made settings for the command-line tools and editors that talk to this router. Nothing here is sent anywhere; the snippets are built in your browser.
      </p>

      {fresh && <SecretBanner title={fresh.title} secret={fresh.key} onDismiss={() => setFresh(null)} />}

      <div className="editor">
        <label>Router address
          <input type="text" value={base} onChange={(e) => setBase(e.target.value.replace(/\/+$/, ""))} />
        </label>
        <p className="muted">
          Inference is blocked on the public hostname by design. Use the address of the machine the router runs on (for example <code>http://127.0.0.1:20128</code>{" "}
          through an SSH tunnel), not the address of this page, unless you opened it up.
        </p>
        <label>API key
          <input type="password" autoComplete="off" placeholder="paste a key, or create one" value={key} onChange={(e) => setKey(e.target.value)} />
        </label>
        <div><button type="button" className="btn-ghost" disabled={busy !== null} onClick={makeKey}>{busy ? "..." : "Create a key for this tool"}</button></div>
        {error && <p className="bad">{error}</p>}
        <label>Model
          <input type="text" list="styx-models" placeholder="model id or combo name" value={model} onChange={(e) => setModel(e.target.value)} />
          <datalist id="styx-models">{ids.map((id) => <option key={id} value={id} />)}</datalist>
        </label>
      </div>

      <div className="tabs" role="tablist">
        {TOOLS.map((t) => (
          <button key={t.id} role="tab" aria-selected={t.id === tool} className={t.id === tool ? "tab active" : "tab"} onClick={() => setTool(t.id)}>{t.name}</button>
        ))}
      </div>

      {snippet(tool, base || "http://127.0.0.1:20128", shownKey, shownModel).map((s, i) => (
        <Snippet key={`${tool}-${i}`} file={s.file} body={s.body} />
      ))}
    </div>
  );
}

function Snippet({ file, body }: { file?: string; body: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <section className="snippet">
      <div className="section-head">
        <small className="muted">{file ?? ""}</small>
        <button type="button" className="btn-ghost" onClick={() => navigator.clipboard?.writeText(body).then(() => setCopied(true), () => setCopied(false))}>{copied ? "Copied" : "Copy"}</button>
      </div>
      <pre className="json">{body}</pre>
    </section>
  );
}

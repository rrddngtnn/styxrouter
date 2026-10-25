import { useState } from "react";
import { Check, Copy, KeyRound, Play, Sparkles, Terminal } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api.ts";
import { SecretBanner, useAction } from "../lib/actions.tsx";
import { ModelPicker, type CatalogOption } from "../components/ModelPicker.tsx";
import { useFetch } from "../lib/useFetch.ts";
import "./tools.css";

export type ToolId =
  | "claude-code"
  | "codex"
  | "opencode"
  | "aider"
  | "ide"
  | "python"
  | "curl";

interface ToolSpec {
  id: ToolId;
  name: string;
  badge: string;
  summary: string;
}

export const TOOLS: ToolSpec[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    badge: "Anthropic Messages",
    summary: "Point Anthropic's official CLI at StyxRouter's /v1/messages endpoint.",
  },
  {
    id: "codex",
    name: "Codex CLI",
    badge: "OpenAI Responses",
    summary: "Configure ~/.codex/config.toml to route through StyxRouter's /v1/responses wire API.",
  },
  {
    id: "opencode",
    name: "OpenCode",
    badge: "OpenAI SDK",
    summary: "Drop an opencode.json provider block into your project or global config.",
  },
  {
    id: "aider",
    name: "Aider",
    badge: "CLI Flags",
    summary: "Launch Aider with OpenAI-compatible base URL and model flags.",
  },
  {
    id: "ide",
    name: "Cursor / Cline / Roo",
    badge: "IDE Extensions",
    summary: "Connection parameters for Cursor, Cline, Roo Code, Continue, and Kilo Code.",
  },
  {
    id: "python",
    name: "OpenAI Python / TS SDK",
    badge: "SDK Client",
    summary: "Standard OpenAI client configuration in Python and TypeScript.",
  },
  {
    id: "curl",
    name: "cURL Smoke Test",
    badge: "HTTP Probe",
    summary: "Verify authentication and end-to-end model dispatch from any terminal.",
  },
];

export function buildSnippets(
  tool: ToolId,
  base: string,
  key: string,
  model: string,
): { title: string; file: string; body: string }[] {
  switch (tool) {
    case "claude-code":
      return [
        {
          title: "Shell environment & launch",
          file: "bash / zsh",
          body: `export ANTHROPIC_BASE_URL="${base}"\nexport ANTHROPIC_AUTH_TOKEN="${key}"\nexport ANTHROPIC_MODEL="${model}"\nclaude`,
        },
      ];
    case "codex":
      return [
        {
          title: "Provider configuration",
          file: "~/.codex/config.toml",
          body: `model = "${model}"\nmodel_provider = "styx"\n\n[model_providers.styx]\nname = "StyxRouter"\nbase_url = "${base}/v1"\nenv_key = "STYX_API_KEY"\nwire_api = "responses"`,
        },
        {
          title: "Export key & launch",
          file: "bash / zsh",
          body: `export STYX_API_KEY="${key}"\ncodex`,
        },
      ];
    case "opencode":
      return [
        {
          title: "Project or global config",
          file: "opencode.json",
          body: JSON.stringify(
            {
              $schema: "https://opencode.ai/config.json",
              provider: {
                styx: {
                  npm: "@ai-sdk/openai-compatible",
                  name: "StyxRouter",
                  options: { baseURL: `${base}/v1`, apiKey: key },
                  models: { [model]: {} },
                },
              },
              model: `styx/${model}`,
            },
            null,
            2,
          ),
        },
      ];
    case "python":
      return [
        {
          title: "OpenAI Python SDK",
          file: "main.py",
          body: `from openai import OpenAI\n\nclient = OpenAI(\n    base_url="${base}/v1",\n    api_key="${key}",\n)\n\nresp = client.chat.completions.create(\n    model="${model}",\n    messages=[{"role": "user", "content": "Hello!"}],\n)\nprint(resp.choices[0].message.content)`,
        },
      ];
    case "aider":
      return [
        {
          title: "Launch command",
          file: "bash / zsh",
          body: `aider \\\n  --openai-api-base "${base}/v1" \\\n  --openai-api-key "${key}" \\\n  --model "openai/${model}"`,
        },
      ];
    case "ide":
      return [
        {
          title: "Extension settings (Cline / Roo Code / Cursor / Continue)",
          file: "OpenAI-Compatible Provider",
          body: `API Provider   : OpenAI Compatible\nBase URL       : ${base}/v1\nAPI Key        : ${key}\nModel ID       : ${model}`,
        },
      ];
    case "curl":
      return [
        {
          title: "Chat completions probe",
          file: "bash / zsh",
          body: `curl -sS ${base}/v1/chat/completions \\\n  -H "Authorization: Bearer ${key}" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "model": "${model}",\n    "messages": [{"role": "user", "content": "Reply with the word ok."}],\n    "max_tokens": 16\n  }'`,
        },
      ];
  }
}

export function Tools() {
  const [tool, setTool] = useState<ToolId>("claude-code");
  const [base, setBase] = useState(() => location.origin);
  const [key, setKey] = useState("");
  const [model, setModel] = useState("");
  const [fresh, setFresh] = useState<{ title: string; key: string } | null>(null);
  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<{
    ok: boolean;
    status: number;
    latencyMs: number;
    reply: string;
  } | null>(null);

  const models = useFetch<{ data?: CatalogOption[] }>("/v1/models?configuredOnly=true&prefix=canonical");
  const catalog = models.status === "ok" ? models.data.data ?? [] : [];
  const defaultModel =
    catalog.find((m) => m.owned_by && m.owned_by !== "combo")?.id ??
    catalog[0]?.id ??
    "antigravity/gemini-4-argon-high";

  const { busy, error, run } = useAction();

  const activeSpec = TOOLS.find((t) => t.id === tool) ?? TOOLS[0]!;
  const shownBase = base.trim() || "http://127.0.0.1:20128";
  const hasRealKey = key.trim().length > 0;
  const shownKey = hasRealKey ? key.trim() : "YOUR_STYX_KEY";
  const shownModel = model.trim() || defaultModel;

  async function makeKey() {
    const name = `${activeSpec.name}`.slice(0, 40);
    const made = await run("key", () => api.post<{ key: string; name: string }>("/api/keys", { name }));
    if (made) {
      setKey(made.key);
      setFresh({ title: `New key “${made.name}”`, key: made.key });
      toast.success(`Generated & filled API key for ${made.name}`);
    }
  }

  async function runLiveProbe() {
    if (!hasRealKey) {
      toast.error("Paste an API key or click “Generate key” first to run a live test.");
      return;
    }
    setProbing(true);
    setProbeResult(null);
    const started = performance.now();
    try {
      const res = await fetch(`${shownBase}/v1/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key.trim()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: shownModel,
          messages: [{ role: "user", content: "Reply with the word ok." }],
          max_tokens: 16,
        }),
      });
      const latencyMs = Math.round(performance.now() - started);
      const payload: any = await res.json().catch(() => null);
      if (!res.ok) {
        const errMsg = payload?.error?.message ?? payload?.error ?? res.statusText;
        setProbeResult({ ok: false, status: res.status, latencyMs, reply: String(errMsg) });
        toast.error(`Test failed (${res.status})`);
      } else {
        const text =
          payload?.choices?.[0]?.message?.content ??
          payload?.choices?.[0]?.reasoning_content ??
          JSON.stringify(payload).slice(0, 120);
        setProbeResult({ ok: true, status: res.status, latencyMs, reply: String(text).trim() || "(empty response)" });
        toast.success(`200 OK in ${latencyMs}ms`);
      }
    } catch (e) {
      const latencyMs = Math.round(performance.now() - started);
      const msg = e instanceof Error ? e.message : String(e);
      setProbeResult({ ok: false, status: 0, latencyMs, reply: msg });
      toast.error(`Connection error: ${msg}`);
    } finally {
      setProbing(false);
    }
  }

  const snippets = buildSnippets(tool, shownBase, shownKey, shownModel);

  return (
    <div className="page tools-page">
      <div className="section-head" style={{ marginBottom: 16 }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>Connect tools</h1>
          <p className="muted" style={{ margin: 0 }}>
            Generate ready-to-paste client configs and test your API key against any model in real time.
          </p>
        </div>
        <div className="row-actions">
          <button type="button" className="btn-ghost" disabled={busy !== null} onClick={makeKey}>
            <KeyRound size={14} />
            <span>{busy === "key" ? "Generating…" : `Generate key for ${activeSpec.name}`}</span>
          </button>
          <button type="button" className="btn-add" disabled={probing} onClick={runLiveProbe}>
            <Play size={14} />
            <span>{probing ? "Testing…" : "Test connection"}</span>
          </button>
        </div>
      </div>

      {fresh && <SecretBanner title={fresh.title} secret={fresh.key} onDismiss={() => setFresh(null)} />}

      <section className="card tools-config-card">
        <div className="tools-config-grid">
          <label className="tools-field">
            <span>Router base URL</span>
            <input
              type="text"
              value={base}
              placeholder="http://127.0.0.1:20128"
              onChange={(e) => setBase(e.target.value.replace(/\/+$/, ""))}
            />
            <small className="muted">
              Current origin: <code>{location.origin}</code>. Use loopback or your tunnel URL.
            </small>
          </label>

          <label className="tools-field">
            <span>Client API key</span>
            <input
              type="password"
              autoComplete="off"
              placeholder="Paste sk-… or click Generate key above"
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
            <small className={hasRealKey ? "ok" : "muted"}>
              {hasRealKey
                ? `Key injected into snippets (${key.trim().slice(0, 10)}…)`
                : "Using placeholder YOUR_STYX_KEY — generate or paste a key before copying."}
            </small>
          </label>

          <div className="tools-field">
            <ModelPicker
              label={`Target model (default: ${defaultModel})`}
              value={model}
              onChange={setModel}
              catalog={catalog}
            />
          </div>
        </div>
        {error && <p className="bad" style={{ margin: "10px 0 0" }}>{error}</p>}
      </section>

      {probeResult && (
        <section
          className={`card tools-probe-banner ${probeResult.ok ? "probe-ok" : "probe-bad"}`}
          role="status"
        >
          <div className="section-head">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Sparkles size={15} />
              <strong>
                {probeResult.ok ? "Live dispatch succeeded" : "Live dispatch failed"}
              </strong>
              <code className="provider-id">
                {probeResult.status ? `HTTP ${probeResult.status}` : "NETWORK"} · {probeResult.latencyMs}ms
              </code>
              <code className="provider-id">{shownModel}</code>
            </div>
            <button type="button" className="btn-ghost" onClick={() => setProbeResult(null)}>
              Dismiss
            </button>
          </div>
          <pre className="tools-probe-reply">{probeResult.reply}</pre>
        </section>
      )}

      <div className="tools-workspace">
        <div className="tools-selector" role="tablist" aria-label="Client tools">
          {TOOLS.map((t) => {
            const active = t.id === tool;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                className={active ? "tools-tab active" : "tools-tab"}
                onClick={() => setTool(t.id)}
              >
                <div className="tools-tab-top">
                  <strong>{t.name}</strong>
                  <span className="vendor-badge">{t.badge}</span>
                </div>
                <small>{t.summary}</small>
              </button>
            );
          })}
        </div>

        <div className="tools-output">
          {!hasRealKey && (
            <div className="tools-key-notice">
              <span>
                Snippets currently contain <code>YOUR_STYX_KEY</code>. Click{" "}
                <strong>Generate key for {activeSpec.name}</strong> to inject a working Bearer token automatically.
              </span>
            </div>
          )}
          {snippets.map((s, i) => (
            <SnippetCard key={`${tool}-${i}`} title={s.title} file={s.file} body={s.body} />
          ))}
        </div>
      </div>
    </div>
  );
}

function SnippetCard({ title, file, body }: { title: string; file: string; body: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <section className="tools-snippet-card">
      <header className="tools-snippet-head">
        <div className="tools-snippet-meta">
          <Terminal size={14} />
          <strong>{title}</strong>
          <code>{file}</code>
        </div>
        <button
          type="button"
          className="btn-ghost"
          onClick={() =>
            navigator.clipboard?.writeText(body).then(
              () => {
                setCopied(true);
                toast.success(`Copied ${file} snippet`);
                setTimeout(() => setCopied(false), 2000);
              },
              () => setCopied(false),
            )
          }
        >
          {copied ? (
            <>
              <Check size={13} />
              <span>Copied</span>
            </>
          ) : (
            <>
              <Copy size={13} />
              <span>Copy snippet</span>
            </>
          )}
        </button>
      </header>
      <pre className="tools-snippet-body">{body}</pre>
    </section>
  );
}

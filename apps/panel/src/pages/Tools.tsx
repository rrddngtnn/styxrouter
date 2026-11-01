import { useTranslator } from "../lib/useTranslator.ts";
import { useState } from "react";
import { Check, Copy, Globe, KeyRound, Network, Play, Sparkles, Terminal } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api.ts";
import { SecretBanner, useAction } from "../lib/actions.tsx";
import { ModelPicker, type CatalogOption } from "../components/ModelPicker.tsx";
import { TableScroll } from "../components/TableScroll.tsx";
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

export type ExtraToolId = "hermes-agent" | "factory-droid" | "goose";
export type AnyToolId = ToolId | ExtraToolId;
export type TunnelModeId = "local" | "ssh" | "cloudflared" | "tailscale" | "caddy";

interface ToolSpec<T extends string = ToolId> {
  id: T;
  name: string;
  badge: string;
  summary: string;
}

export const TOOLS: ToolSpec<ToolId>[] = [
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

export const EXTRA_TOOLS: ToolSpec<ExtraToolId>[] = [
  {
    id: "hermes-agent",
    name: "Hermes Agent",
    badge: "Autonomous Agent",
    summary: "Wire Nous Research's Hermes Agent (~/.hermes/config.yaml & .env) to StyxRouter's OpenAI or Anthropic endpoints.",
  },
  {
    id: "factory-droid",
    name: "Factory Droid",
    badge: "BYOK Agent",
    summary: "Configure ~/.factory/config.json custom models for Droid CLI with OpenAI or Anthropic wire format.",
  },
  {
    id: "goose",
    name: "Goose / OpenHands",
    badge: "Agent Harness",
    summary: "Configure Block Goose CLI or OpenHands agent containers against StyxRouter's /v1 gateway.",
  },
];

export const ALL_TOOLS: ToolSpec<AnyToolId>[] = [...TOOLS, ...EXTRA_TOOLS];

export interface TunnelModeSpec {
  id: TunnelModeId;
  name: string;
  badge: string;
  summary: string;
  recommendedBase: (port: string, host: string) => string;
}

export const TUNNEL_MODES: TunnelModeSpec[] = [
  {
    id: "local",
    name: "Local Loopback",
    badge: "Same Machine",
    summary: "Harness and StyxRouter run on the same workstation or server (zero network hops).",
    recommendedBase: (port) => `http://127.0.0.1:${port}`,
  },
  {
    id: "ssh",
    name: "SSH Port-Forward Tunnel",
    badge: "VPS → Laptop",
    summary: "Keep StyxRouter bound to 127.0.0.1 on your VPS and forward the port securely over SSH to your local machine.",
    recommendedBase: (port) => `http://127.0.0.1:${port}`,
  },
  {
    id: "cloudflared",
    name: "Cloudflare Tunnel (cloudflared)",
    badge: "Public HTTPS",
    summary: "Expose local or VPS StyxRouter over HTTPS without opening firewall ports (required for Cursor IDE cloud relay).",
    recommendedBase: (_port, host) => `https://${host}`,
  },
  {
    id: "tailscale",
    name: "Tailscale Mesh / Serve",
    badge: "Private WireGuard",
    summary: "Access StyxRouter across your personal tailnet via MagicDNS HTTPS or Tailscale Funnel.",
    recommendedBase: (_port, host) => `https://${host}`,
  },
  {
    id: "caddy",
    name: "Caddy / Nginx Reverse Proxy",
    badge: "Production TLS",
    summary: "Serve StyxRouter on a custom HTTPS domain with unbuffered SSE streaming for long reasoning traces.",
    recommendedBase: (_port, host) => `https://${host}`,
  },
];

export function buildSnippets(
  tool: AnyToolId,
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
        {
          title: "Persistent settings (never type export again)",
          file: "~/.claude/settings.json",
          body: JSON.stringify(
            {
              env: {
                ANTHROPIC_BASE_URL: base,
                ANTHROPIC_AUTH_TOKEN: key,
                ANTHROPIC_MODEL: model,
                ANTHROPIC_SMALL_FAST_MODEL: model,
                CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
              },
            },
            null,
            2,
          ),
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
    case "hermes-agent":
      return [
        {
          title: "Hermes Agent configuration",
          file: "~/.hermes/config.yaml",
          body: `model:\n  provider: custom\n  name: "${model}"\n  base_url: "${base}/v1"\n  api_key_env: STYX_API_KEY`,
        },
        {
          title: "Environment secret & CLI launch",
          file: "~/.hermes/.env",
          body: `echo 'STYX_API_KEY=${key}' >> ~/.hermes/.env\nexport OPENAI_BASE_URL="${base}/v1"\nexport OPENAI_API_KEY="${key}"\nhermes --model "${model}"`,
        },
      ];
    case "factory-droid":
      return [
        {
          title: "Factory Droid BYOK configuration",
          file: "~/.factory/config.json",
          body: JSON.stringify(
            {
              custom_models: [
                {
                  model_display_name: `Styx (${model})`,
                  model,
                  base_url: `${base}/v1`,
                  api_key: key,
                  provider: "generic-chat-completion-api",
                  max_tokens: 32000,
                },
              ],
            },
            null,
            2,
          ),
        },
      ];
    case "goose":
      return [
        {
          title: "Block Goose / OpenHands environment",
          file: "bash / zsh",
          body: `export GOOSE_PROVIDER="openai"\nexport OPENAI_HOST="${base}"\nexport OPENAI_BASE_URL="${base}/v1"\nexport OPENAI_API_KEY="${key}"\nexport GOOSE_MODEL="${model}"\ngoose session`,
        },
      ];
    case "python":
      return [
        {
          title: "OpenAI Python SDK",
          file: "main.py",
          body: `from openai import OpenAI\n\nclient = OpenAI(\n    base_url="${base}/v1",\n    api_key="${key}",\n)\n\nresp = client.chat.completions.create(\n    model="${model}",\n    messages=[{"role": "user", "content": "Hello!"}],\n)\nprint(resp.choices[0].message.content)`,
        },
        {
          title: "OpenAI TypeScript / Bun SDK",
          file: "index.ts",
          body: `import OpenAI from "openai";\n\nconst client = new OpenAI({\n  baseURL: "${base}/v1",\n  apiKey: "${key}",\n});\n\nconst res = await client.chat.completions.create({\n  model: "${model}",\n  messages: [{ role: "user", content: "Hello!" }],\n});\nconsole.log(res.choices[0]?.message?.content);`,
        },
      ];
    case "aider":
      return [
        {
          title: "Launch command",
          file: "bash / zsh",
          body: `aider \\\n  --openai-api-base "${base}/v1" \\\n  --openai-api-key "${key}" \\\n  --model "openai/${model}"`,
        },
        {
          title: "Persistent Aider config",
          file: "~/.aider.conf.yml",
          body: `openai-api-base: ${base}/v1\nopenai-api-key: ${key}\nmodel: openai/${model}\nauto-commits: false`,
        },
      ];
    case "ide":
      return [
        {
          title: "Extension settings (Cline / Roo Code / Cursor / Continue)",
          file: "OpenAI-Compatible Provider",
          body: `API Provider   : OpenAI Compatible\nBase URL       : ${base}/v1\nAPI Key        : ${key}\nModel ID       : ${model}`,
        },
        {
          title: "Cursor IDE Cloud-Relay Note",
          file: "Cursor Override Base URL",
          body: `# IMPORTANT: Cursor routes OpenAI-Compatible requests through Cursor's cloud servers.\n# Therefore, Cursor CANNOT reach http://127.0.0.1 or a local SSH forward.\n# Switch to the "Tunnels & Network Exposure" tab above and start a Cloudflare Tunnel\n# (cloudflared), Tailscale Funnel, or Caddy HTTPS domain, then paste https://<your-tunnel>/v1.`,
        },
      ];
    case "curl":
      return [
        {
          title: "Chat completions probe",
          file: "bash / zsh",
          body: `curl -sS ${base}/v1/chat/completions \\\n  -H "Authorization: Bearer ${key}" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "model": "${model}",\n    "messages": [{"role": "user", "content": "Reply with the word ok."}],\n    "max_tokens": 16\n  }'`,
        },
        {
          title: "Anthropic Messages probe (Claude Code wire)",
          file: "bash / zsh",
          body: `curl -sS ${base}/v1/messages \\\n  -H "x-api-key: ${key}" \\\n  -H "anthropic-version: 2023-06-01" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "model": "${model}",\n    "max_tokens": 32,\n    "messages": [{"role": "user", "content": "Reply with ok."}]\n  }'`,
        },
        {
          title: "OpenAI Responses probe (Codex wire)",
          file: "bash / zsh",
          body: `curl -sS ${base}/v1/responses \\\n  -H "Authorization: Bearer ${key}" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "model": "${model}",\n    "input": "Reply with the word ok."\n  }'`,
        },
      ];
  }
}

export function buildTunnelSnippets(
  mode: TunnelModeId,
  localPort: string,
  publicHost: string,
  sshTarget: string,
): { title: string; file: string; body: string }[] {
  const port = localPort.trim() || "20128";
  const host = publicHost.trim() || "styx.example.com";
  const ssh = sshTarget.trim() || "user@your-vps-ip";

  switch (mode) {
    case "local":
      return [
        {
          title: "Verify local listener & health",
          file: "bash / zsh",
          body: `curl -sS http://127.0.0.1:${port}/api/health\n# Harnesses on this machine connect directly to: http://127.0.0.1:${port}`,
        },
        {
          title: "Lock server bind address to loopback only",
          file: "apps/server/.env",
          body: `HOST=127.0.0.1\nPORT=${port}`,
        },
      ];
    case "ssh":
      return [
        {
          title: "Background SSH local port-forward (run on your laptop)",
          file: "bash / zsh",
          body: `ssh -fN -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -L ${port}:127.0.0.1:${port} ${ssh}\n\n# Now point local Claude Code / Codex / OpenCode at:\n# http://127.0.0.1:${port}`,
        },
        {
          title: "Persistent SSH config profile",
          file: "~/.ssh/config",
          body: `Host styx-tunnel\n  HostName ${ssh.includes("@") ? ssh.split("@")[1] : ssh}\n  User ${ssh.includes("@") ? ssh.split("@")[0] : "root"}\n  LocalForward ${port} 127.0.0.1:${port}\n  ServerAliveInterval 30\n  ServerAliveCountMax 3\n\n# Connect anytime with: ssh -fN styx-tunnel`,
        },
      ];
    case "cloudflared":
      return [
        {
          title: "Quick ephemeral HTTPS tunnel (zero config, works with Cursor IDE)",
          file: "bash / zsh",
          body: `cloudflared tunnel --url http://127.0.0.1:${port}\n# Copy the generated https://*.trycloudflare.com URL into "Router base URL" above.`,
        },
        {
          title: "Named persistent Cloudflare Tunnel config",
          file: "~/.cloudflared/config.yml",
          body: `tunnel: styxrouter\ncredentials-file: /root/.cloudflared/styxrouter.json\n\ningress:\n  - hostname: ${host}\n    service: http://127.0.0.1:${port}\n    originRequest:\n      noHappyEyeballs: true\n      keepAliveTimeout: 120s\n  - service: http_status:404`,
        },
      ];
    case "tailscale":
      return [
        {
          title: "Tailscale Serve (private HTTPS inside your tailnet)",
          file: "bash / zsh",
          body: `tailscale serve --bg ${port}\n# Accessible from any device on your tailnet via https://${host}`,
        },
        {
          title: "Tailscale Funnel (public HTTPS for Cursor cloud relay / webhooks)",
          file: "bash / zsh",
          body: `tailscale funnel --bg ${port}`,
        },
      ];
    case "caddy":
      return [
        {
          title: "Caddyfile with unbuffered SSE streaming",
          file: "/etc/caddy/Caddyfile",
          body: `${host} {\n  reverse_proxy 127.0.0.1:${port} {\n    flush_interval -1\n    transport http {\n      read_timeout 600s\n      write_timeout 600s\n    }\n  }\n}`,
        },
        {
          title: "Nginx TLS reverse proxy with proxy_buffering off",
          file: "/etc/nginx/conf.d/styxrouter.conf",
          body: `server {\n  listen 443 ssl http2;\n  server_name ${host};\n\n  location / {\n    proxy_pass http://127.0.0.1:${port};\n    proxy_http_version 1.1;\n    proxy_set_header Host $host;\n    proxy_set_header X-Real-IP $remote_addr;\n    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n    proxy_set_header X-Forwarded-Proto $scheme;\n    proxy_buffering off;\n    proxy_cache off;\n    proxy_read_timeout 600s;\n  }\n}`,
        },
      ];
  }
}

export function Tools() {
  const tr = useTranslator();
  const [workspaceTab, setWorkspaceTab] = useState<"harnesses" | "tunnels" | "endpoints">("harnesses");
  const [tool, setTool] = useState<AnyToolId>("claude-code");
  const [tunnelMode, setTunnelMode] = useState<TunnelModeId>("ssh");
  const [base, setBase] = useState(() => location.origin);
  const [key, setKey] = useState("");
  const [model, setModel] = useState("");
  const [localPort, setLocalPort] = useState(() => location.port || "20128");
  const [publicHost, setPublicHost] = useState(() =>
    location.hostname && location.hostname !== "127.0.0.1" && location.hostname !== "localhost"
      ? location.hostname
      : "styx.yourdomain.com",
  );
  const [sshTarget, setSshTarget] = useState("user@your-vps-ip");
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

  const activeSpec = ALL_TOOLS.find((t) => t.id === tool) ?? ALL_TOOLS[0]!;
  const activeTunnel = TUNNEL_MODES.find((m) => m.id === tunnelMode) ?? TUNNEL_MODES[0]!;
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
  const tunnelSnippets = buildTunnelSnippets(tunnelMode, localPort, publicHost, sshTarget);

  return (
    <div className="page tools-page">
      <div className="section-head" style={{ marginBottom: 16 }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>{tr("Connect tools")}</h1>
          <p className="muted" style={{ margin: 0 }}>
            {tr("Generate ready-to-paste client configs, tunnel setups (Local, SSH, Cloudflare, Tailscale, Caddy), and test live dispatch.")}
          </p>
        </div>
        <div className="row-actions" style={{ flexWrap: "wrap" }}>
          <button type="button" className="btn-ghost" disabled={busy !== null} onClick={makeKey}>
            <KeyRound size={14} />
            <span>{busy === "key" ? tr("Generating…") : tr("Generate key for {0}", {0: String(activeSpec.name)})}</span>
          </button>
          <button type="button" className="btn-add" disabled={probing} onClick={runLiveProbe}>
            <Play size={14} />
            <span>{probing ? tr("Testing…") : tr("Test connection")}</span>
          </button>
        </div>
      </div>

      {fresh && <SecretBanner title={fresh.title} secret={fresh.key} onDismiss={() => setFresh(null)} />}

      <section className="card tools-config-card">
        <div className="tools-config-grid">
          <label className="tools-field">
            <span>{tr("Router base URL")}</span>
            <input
              type="text"
              value={base}
              placeholder="http://127.0.0.1:20128"
              onChange={(e) => setBase(e.target.value.replace(/\/+$/, ""))}
            />
            <small className="muted" style={{ overflowWrap: "anywhere" }}>{tr("Current origin:")}<code>{location.origin}</code>{tr(". Use loopback or your tunnel URL.")}</small>
          </label>

          <label className="tools-field">
            <span>{tr("Client API key")}</span>
            <input
              type="password"
              autoComplete="off"
              placeholder={tr("Paste sk-… or click Generate key above")}
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
            <small className={hasRealKey ? "ok" : "muted"}>
              {hasRealKey
                ? tr("Key injected into snippets ({0}…)", {0: String(key.trim().slice(0, 10))})
                : tr("Using placeholder YOUR_STYX_KEY — generate or paste a key before copying.")}
            </small>
          </label>

          <div className="tools-field">
            <ModelPicker
              label={tr("Target model (default: {0})", {0: String(defaultModel)})}
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
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <Sparkles size={15} />
              <strong>
                {probeResult.ok ? tr("Live dispatch succeeded") : tr("Live dispatch failed")}
              </strong>
              <code className="provider-id">
                {probeResult.status ? `HTTP ${probeResult.status}` : "NETWORK"} · {probeResult.latencyMs}ms
              </code>
              <code className="provider-id">{shownModel}</code>
            </div>
            <button type="button" className="btn-ghost" onClick={() => setProbeResult(null)}>{tr("Dismiss")}</button>
          </div>
          <pre className="tools-probe-reply">{probeResult.reply}</pre>
        </section>
      )}

      <div className="tabs" role="tablist" aria-label={tr("Integration mode")} style={{ flexWrap: "wrap" }}>
        <button
          type="button"
          role="tab"
          aria-selected={workspaceTab === "harnesses"}
          className={workspaceTab === "harnesses" ? "tab active" : "tab"}
          onClick={() => setWorkspaceTab("harnesses")}
        >
          <Terminal size={14} />
          <span>{tr("Client Harnesses & SDKs")}</span>
          <span className="tab-count">{ALL_TOOLS.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={workspaceTab === "tunnels"}
          className={workspaceTab === "tunnels" ? "tab active" : "tab"}
          onClick={() => setWorkspaceTab("tunnels")}
        >
          <Network size={14} />
          <span>{tr("Tunnels & Network Exposure")}</span>
          <span className="tab-count">{TUNNEL_MODES.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={workspaceTab === "endpoints"}
          className={workspaceTab === "endpoints" ? "tab active" : "tab"}
          onClick={() => setWorkspaceTab("endpoints")}
        >
          <Globe size={14} />
          <span>{tr("Wire Protocol Matrix")}</span>
        </button>
      </div>

      {workspaceTab === "harnesses" && (
        <div className="tools-workspace">
          <div className="tools-selector" role="tablist" aria-label={tr("Client tools")}>
            {ALL_TOOLS.map((t) => {
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
                    <span className="vendor-badge">{tr(t.badge)}</span>
                  </div>
                  <small>{tr(t.summary)}</small>
                </button>
              );
            })}
          </div>

          <div className="tools-output">
            {!hasRealKey && (
              <div className="tools-key-notice">
                <span>
                  {tr("Snippets currently contain")} <code>YOUR_STYX_KEY</code>{tr(". Click")}{" "}
                  <strong>{tr("Generate key for")} {activeSpec.name}</strong> {tr("to inject a working Bearer token automatically.")}
                </span>
              </div>
            )}
            {snippets.map((s, i) => (
              <SnippetCard key={`${tool}-${i}`} title={s.title} file={s.file} body={s.body} />
            ))}
          </div>
        </div>
      )}

      {workspaceTab === "tunnels" && (
        <div className="tools-workspace">
          <div className="tools-selector" role="tablist" aria-label={tr("Tunnel topologies")}>
            {TUNNEL_MODES.map((m) => {
              const active = m.id === tunnelMode;
              return (
                <button
                  key={m.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={active ? "tools-tab active" : "tools-tab"}
                  onClick={() => setTunnelMode(m.id)}
                >
                  <div className="tools-tab-top">
                    <strong>{tr(m.name)}</strong>
                    <span className="vendor-badge">{tr(m.badge)}</span>
                  </div>
                  <small>{tr(m.summary)}</small>
                </button>
              );
            })}
          </div>

          <div className="tools-output">
            <section className="card" style={{ padding: 14 }}>
              <div className="tools-config-grid">
                <label className="tools-field">
                  <span>{tr("Local StyxRouter port")}</span>
                  <input
                    type="text"
                    value={localPort}
                    placeholder="20128"
                    onChange={(e) => setLocalPort(e.target.value)}
                  />
                </label>
                <label className="tools-field">
                  <span>{tr("Public / Tailnet hostname")}</span>
                  <input
                    type="text"
                    value={publicHost}
                    placeholder="styx.yourdomain.com"
                    onChange={(e) => setPublicHost(e.target.value)}
                  />
                </label>
                <label className="tools-field">
                  <span>{tr("VPS SSH target (for SSH tunnel)")}</span>
                  <input
                    type="text"
                    value={sshTarget}
                    placeholder="user@192.0.2.20"
                    onChange={(e) => setSshTarget(e.target.value)}
                  />
                </label>
              </div>
              <div className="row-actions" style={{ marginTop: 12, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn-add"
                  onClick={() => {
                    const nextBase = activeTunnel.recommendedBase(localPort || "20128", publicHost || "styx.yourdomain.com");
                    setBase(nextBase);
                    toast.success(`Base URL updated to ${nextBase}`);
                  }}
                >
                  <span>
                    {tr("Use")} {activeTunnel.recommendedBase(localPort || "20128", publicHost || "styx.yourdomain.com")} {tr("in harness snippets")}
                  </span>
                </button>
              </div>
            </section>

            {tunnelSnippets.map((s, i) => (
              <SnippetCard key={`${tunnelMode}-${i}`} title={s.title} file={s.file} body={s.body} />
            ))}
          </div>
        </div>
      )}

      {workspaceTab === "endpoints" && (
        <section className="card" style={{ padding: 0, overflow: "hidden" }}>
          <TableScroll label={tr("StyxRouter wire protocol endpoints")} stickyPrimary>
            <table className="table">
              <thead>
                <tr>
                  <th>{tr("Endpoint Path")}</th>
                  <th>{tr("Wire Protocol")}</th>
                  <th>{tr("Auth Header")}</th>
                  <th>{tr("Compatible Harnesses")}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><code>{shownBase}/v1/chat/completions</code></td>
                  <td>OpenAI Chat Completions (SSE & JSON)</td>
                  <td><code>Authorization: Bearer &lt;key&gt;</code></td>
                  <td>Hermes Agent, OpenCode, Aider, Cursor, Cline, Roo Code, Continue, Factory Droid, Goose</td>
                </tr>
                <tr>
                  <td><code>{shownBase}/v1/messages</code></td>
                  <td>Anthropic Messages API (with Thinking blocks)</td>
                  <td><code>x-api-key: &lt;key&gt;</code> or <code>Bearer</code></td>
                  <td>Claude Code CLI, Anthropic Python/TS SDK</td>
                </tr>
                <tr>
                  <td><code>{shownBase}/v1/responses</code></td>
                  <td>OpenAI Responses API (Stateful & Reasoning)</td>
                  <td><code>Authorization: Bearer &lt;key&gt;</code></td>
                  <td>OpenAI Codex CLI (<code>wire_api = "responses"</code>), OpenAI SDK</td>
                </tr>
                <tr>
                  <td><code>{shownBase}/v1/models</code></td>
                  <td>Model Discovery Catalog</td>
                  <td><code>Authorization: Bearer &lt;key&gt;</code></td>
                  <td>All IDEs and CLIs for dynamic model dropdown population</td>
                </tr>
                <tr>
                  <td><code>{shownBase}/v1/embeddings</code></td>
                  <td>OpenAI Embeddings Wire</td>
                  <td><code>Authorization: Bearer &lt;key&gt;</code></td>
                  <td>Codebase indexers (Continue, Roo Code, RAG pipelines)</td>
                </tr>
              </tbody>
            </table>
          </TableScroll>
        </section>
      )}
    </div>
  );
}

function SnippetCard({ title, file, body }: { title: string; file: string; body: string }) {
  const tr = useTranslator();
  const [copied, setCopied] = useState(false);
  return (
    <section className="tools-snippet-card">
      <header className="tools-snippet-head">
        <div className="tools-snippet-meta">
          <Terminal size={14} />
          <strong>{tr(title)}</strong>
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
              <span>{tr("Copied")}</span>
            </>
          ) : (
            <>
              <Copy size={13} />
              <span>{tr("Copy snippet")}</span>
            </>
          )}
        </button>
      </header>
      <pre className="tools-snippet-body">{body}</pre>
    </section>
  );
}

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
    summary: "Wire Nous Research's Hermes Agent (~/.hermes/config.yaml & .env) to StyxRouter's OpenAI-compatible endpoint.",
  },
  {
    id: "factory-droid",
    name: "Factory Droid",
    badge: "BYOK Agent",
    summary: "Configure ~/.factory/settings.json custom models for Droid CLI with OpenAI or Anthropic wire format.",
  },
  {
    id: "goose",
    name: "Goose",
    badge: "Agent Harness",
    summary: "Configure Block Goose CLI against StyxRouter's /v1 gateway.",
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
    summary: "Public HTTPS via a named tunnel. Quick Tunnels do not support SSE streaming.",
    recommendedBase: (_port, host) => `https://${host}`,
  },
  {
    id: "tailscale",
    name: "Tailscale Mesh / Serve",
    badge: "Private WireGuard",
    summary: "Private Serve and public Funnel are different exposure modes. Use the actual tailnet HTTPS URL.",
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

// Quote values for POSIX shells; never interpolate user text into executable syntax.
const shellQuote = (value: string) => "'" + value.replace(/'/g, "'\"'\"'") + "'";
const literal = (value: string) => JSON.stringify(value);

export function normalizeRouterBase(value: string): string {
  if (/[\x00-\x20\x7f]/.test(value.trim())) throw new Error("Base URL must not contain whitespace or controls.");
  const url = new URL(value.trim());
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("Use an HTTP(S) base URL without credentials, query, or fragment.");
  }
  return url.href.replace(/\/+$/, "").replace(/\/v1$/, "");
}

export function buildSnippets(
  tool: AnyToolId,
  base: string,
  key: string,
  model: string,
): { title: string; file: string; body: string }[] {
  base = normalizeRouterBase(base);
  switch (tool) {
    case "claude-code":
      return [
        {
          title: "Shell environment & launch",
          file: "bash / zsh",
          body: `export ANTHROPIC_BASE_URL=${shellQuote(base)}\nexport ANTHROPIC_AUTH_TOKEN=${shellQuote(key)}\nexport ANTHROPIC_MODEL=${shellQuote(model)}\nclaude`,
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
                ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
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
          body: `model = ${literal(model)}\nmodel_provider = "styx"\n\n[model_providers.styx]\nname = "StyxRouter"\nbase_url = "${base}/v1"\nenv_key = "STYX_API_KEY"\nwire_api = "responses"`,
        },
        {
          title: "Export key & launch",
          file: "bash / zsh",
          body: `export STYX_API_KEY=${shellQuote(key)}\ncodex`,
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
          body: `model:\n  provider: custom\n  default: ${literal(model)}\n  base_url: "${base}/v1"\n  key_env: STYX_API_KEY`,
        },
        {
          title: "Apply settings to the active Hermes profile & launch",
          file: "bash / zsh",
          body: `# Reference above: merge only; do not replace an existing config.\n# These commands use the active HERMES_HOME/profile.\nexport STYX_API_KEY=${shellQuote(key)}\nhermes config set model.provider custom\nhermes config set model.default ${shellQuote(model)}\nhermes config set model.base_url ${shellQuote(base + "/v1")}\nhermes config set model.key_env STYX_API_KEY\nhermes`,
        },
      ];
    case "factory-droid":
      return [
        {
          title: "Factory Droid BYOK configuration",
          file: "~/.factory/settings.json",
          body: JSON.stringify(
            {
              customModels: [
                {
                  displayName: `Styx (${model})`,
                  model,
                  baseUrl: `${base}/v1`,
                  apiKey: "${STYX_API_KEY}",
                  provider: "generic-chat-completion-api",
                },
              ],
            },
            null,
            2,
          ),
        },
        { title: "Export key; launch and select the custom model with /model", file: "bash / zsh", body: `export STYX_API_KEY=${shellQuote(key)}\ndroid` },
      ];
    case "goose": {
      const url = new URL(base);
      return [{
        title: "Block Goose OpenAI-compatible environment", file: "bash / zsh",
        body: `export GOOSE_PROVIDER='openai'\nexport OPENAI_HOST=${shellQuote(url.origin)}\nexport OPENAI_BASE_PATH=${shellQuote(url.pathname.replace(/^\//, "").replace(/\/$/, "") + (url.pathname === "/" ? "" : "/") + "v1/chat/completions")}\nexport OPENAI_API_KEY=${shellQuote(key)}\nexport GOOSE_MODEL=${shellQuote(model)}\ngoose session`,
      }];
    }
    case "python":
      return [
        {
          title: "OpenAI Python SDK",
          file: "main.py",
          body: `from openai import OpenAI\n\nclient = OpenAI(\n    base_url="${base}/v1",\n    api_key=${literal(key)},\n)\n\nresp = client.chat.completions.create(\n    model=${literal(model)},\n    messages=[{"role": "user", "content": "Hello!"}],\n)\nprint(resp.choices[0].message.content)`,
        },
        {
          title: "OpenAI TypeScript / Bun SDK",
          file: "index.ts",
          body: `import OpenAI from "openai";\n\nconst client = new OpenAI({\n  baseURL: "${base}/v1",\n  apiKey: ${literal(key)},\n});\n\nconst res = await client.chat.completions.create({\n  model: ${literal(model)},\n  messages: [{ role: "user", content: "Hello!" }],\n});\nconsole.log(res.choices[0]?.message?.content);`,
        },
      ];
    case "aider":
      return [
        {
          title: "Launch command",
          file: "bash / zsh",
          body: `aider \\\n  --openai-api-base ${shellQuote(base + "/v1")} \\\n  --openai-api-key ${shellQuote(key)} \\\n  --model ${shellQuote("openai/" + model)}`,
        },
        {
          title: "Persistent Aider config",
          file: "~/.aider.conf.yml",
          body: `openai-api-base: ${literal(base + "/v1")}\nopenai-api-key: ${literal(key)}\nmodel: ${literal("openai/" + model)}\nauto-commits: false`,
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
          body: `# IMPORTANT: Cursor routes OpenAI-Compatible requests through Cursor's cloud servers.\n# Therefore, Cursor CANNOT reach http://127.0.0.1 or a local SSH forward.\n# Use a reviewed public HTTPS endpoint: a named Cloudflare Tunnel (not a Quick Tunnel),\n# Tailscale Funnel, or a TLS reverse proxy. Protect admin routes before exposure.\n# Private Tailscale Serve is not reachable by a public cloud relay.`,
        },
      ];
    case "curl":
      return [
        ["Chat completions probe", "chat/completions", { model, messages: [{ role: "user", content: "Reply with ok." }], max_tokens: 16 }],
        ["Anthropic Messages probe (Claude Code wire)", "messages", { model, messages: [{ role: "user", content: "Reply with ok." }], max_tokens: 32 }],
        ["OpenAI Responses probe (Codex wire)", "responses", { model, input: "Reply with ok." }],
      ].map(([title, path, payload]) => ({
        title: String(title), file: "bash / zsh",
        body: `curl --fail-with-body -sS ${shellQuote(`${base}/v1/${path}`)} -H ${shellQuote(path === "messages" ? `x-api-key: ${key}` : `Authorization: Bearer ${key}`)} -H 'Content-Type: application/json' ${path === "messages" ? "-H 'anthropic-version: 2023-06-01' " : ""}--data-raw ${shellQuote(JSON.stringify(payload, null, 2))}`,
      }));
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
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error("Port must be an integer from 1 to 65535.");
  const hostname = /^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/;
  if (["cloudflared", "tailscale", "caddy"].includes(mode) && (!hostname.test(host) || host.split(".").some(label => !label || label.length > 63 || label.startsWith("-") || label.endsWith("-")))) throw new Error("Enter a DNS hostname only (no scheme, port, or path).");
  if (mode === "ssh" && !/^(?:[a-zA-Z0-9_][a-zA-Z0-9_.-]*@)?[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(ssh)) throw new Error("SSH target must be [user@]hostname; configure IPv6 or advanced options in SSH config.");

  switch (mode) {
    case "local":
      return [
        {
          title: "Verify local listener & health",
          file: "bash / zsh",
          body: `curl -sS http://127.0.0.1:${port}/api/health\n# Harnesses on this machine connect directly to: http://127.0.0.1:${port}`,
        },
        {
          title: "Confirm loopback binding before network exposure",
          file: "operator checklist",
          body: `# Confirm the actual StyxRouter listener is bound to 127.0.0.1:${port}.\n# Check your launcher and deployment configuration; do not assume HOST is honored.\n# Inspect listeners with: ss -ltn\n# Do not expose admin routes or disable authentication to make a tunnel work.`,
        },
      ];
    case "ssh":
      return [
        {
          title: "Foreground SSH local port-forward (run on your laptop; Ctrl-C to stop)",
          file: "bash / zsh",
          body: `ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -L 127.0.0.1:${port}:127.0.0.1:${port} ${ssh}\n\n# Now point local Claude Code / Codex / OpenCode at:\n# http://127.0.0.1:${port}`,
        },
        {
          title: "Persistent SSH config profile",
          file: "~/.ssh/config",
          body: `Host styx-tunnel\n  HostName ${ssh.includes("@") ? ssh.split("@")[1] : ssh}\n${ssh.includes("@") ? `  User ${ssh.split("@")[0]}\n` : ""}  ExitOnForwardFailure yes\n  LocalForward 127.0.0.1:${port} 127.0.0.1:${port}\n  ServerAliveInterval 30\n  ServerAliveCountMax 3\n\n# Connect with: ssh -N styx-tunnel (Ctrl-C to stop)`,
        },
      ];
    case "cloudflared":
      return [
        {
          title: "Quick Tunnel: non-streaming development only",
          file: "bash / zsh",
          body: `# WARNING: Quick Tunnels do not support SSE; do not use for streaming agents.\n# PUBLIC: authenticate API traffic and protect the admin panel first.\ncloudflared tunnel --url http://127.0.0.1:${port}\n# Copy the generated https://*.trycloudflare.com URL into "Router base URL" above.`,
        },
        {
          title: "Named persistent Cloudflare Tunnel config",
          file: "~/.cloudflared/config.yml",
          body: `# Prerequisites: Cloudflare-managed DNS, an already-created named tunnel,\n# and its actual UUID/credentials path (replace placeholders; never copy secrets).\n# PUBLIC: protect admin routes; API-key auth alone does not hide the panel.\ntunnel: TUNNEL_UUID\ncredentials-file: /absolute/path/to/TUNNEL_UUID.json\n\ningress:\n  - hostname: ${host}\n    service: http://127.0.0.1:${port}\n  - service: http_status:404\n\n# After saving and replacing placeholders, operator commands:\n# cloudflared tunnel ingress validate\n# cloudflared tunnel route dns TUNNEL_UUID ${host}\n# cloudflared tunnel run TUNNEL_UUID\n# DNS routing is a write; review before running.`,
        },
      ];
    case "tailscale":
      return [
        {
          title: "Tailscale Serve (private HTTPS inside your tailnet)",
          file: "bash / zsh",
          body: `# Requires an authenticated node, MagicDNS and tailnet HTTPS certificates.\n# Private to permitted tailnet clients; not reachable by a public cloud relay.\ntailscale serve --bg http://127.0.0.1:${port}\ntailscale serve status\n# Use the actual *.ts.net URL reported by status, not an arbitrary custom domain.\n# Stop with: tailscale serve --https=443 off`,
        },
        {
          title: "Tailscale Funnel (public HTTPS for Cursor cloud relay / webhooks)",
          file: "bash / zsh",
          body: `# PUBLIC internet exposure, NOT private Serve. Requires HTTPS, MagicDNS,\n# Funnel policy permission and a supported Tailscale client.\n# Protect admin routes and require scoped API keys before enabling.\ntailscale funnel --bg http://127.0.0.1:${port}\ntailscale funnel status\n# Use the actual *.ts.net URL shown; stop with: tailscale funnel --https=443 off`,
        },
      ];
    case "caddy":
      return [
        {
          title: "Caddyfile with unbuffered SSE streaming",
          file: "/etc/caddy/Caddyfile",
          body: `# Requires DNS A/AAAA pointing to this host and reachable ports 80/443\n# for default automatic HTTPS. Protect admin routes before public exposure.\n# Validate before applying: caddy validate --config /etc/caddy/Caddyfile\n${host} {\n  reverse_proxy 127.0.0.1:${port} {\n    flush_interval -1\n    transport http {\n      read_timeout 600s\n      write_timeout 600s\n    }\n  }\n}`,
        },
        {
          title: "Nginx TLS reverse proxy with proxy_buffering off",
          file: "/etc/nginx/conf.d/styxrouter.conf",
          body: `# First provision a trusted certificate and renewal process for this hostname.\n# Replace these certificate paths; restrict private-key permissions.\n# Protect admin routes before exposure. Validate before applying: nginx -t\nserver {\n  listen 443 ssl;\n  server_name ${host};\n  ssl_certificate /absolute/path/to/fullchain.pem;\n  ssl_certificate_key /absolute/path/to/privkey.pem;\n\n  location / {\n    proxy_pass http://127.0.0.1:${port};\n    proxy_http_version 1.1;\n    proxy_set_header Host $host;\n    proxy_set_header X-Real-IP $remote_addr;\n    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n    proxy_set_header X-Forwarded-Proto $scheme;\n    proxy_buffering off;\n    proxy_cache off;\n    proxy_read_timeout 600s;\n  }\n}`,
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
      const res = await fetch(`${normalizeRouterBase(shownBase)}/v1/chat/completions`, {
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

  // Invalid intermediate input must not crash the page while the user edits.
  let snippets: ReturnType<typeof buildSnippets> = [];
  let tunnelSnippets: ReturnType<typeof buildTunnelSnippets> = [];
  let snippetError = "";
  let tunnelError = "";
  try { snippets = buildSnippets(tool, shownBase, shownKey, shownModel); }
  catch (e) { snippetError = e instanceof Error ? e.message : "Invalid connection settings."; }
  try { tunnelSnippets = buildTunnelSnippets(tunnelMode, localPort, publicHost, sshTarget); }
  catch (e) { tunnelError = e instanceof Error ? e.message : "Invalid tunnel settings."; }

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
          <button type="button" className="btn-add" disabled={probing || !!snippetError} onClick={runLiveProbe}>
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
            {snippetError && <p className="bad" role="alert">{snippetError}</p>}
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
                  disabled={!!tunnelError}
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

            {tunnelError && <p className="bad" role="alert">{tunnelError}</p>}
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

import {useConfirmation} from "../components/ConfirmationDialog";
import {ReadFreshness} from "../components/OperationalUI";
import { useTranslator } from "../lib/useTranslator.ts";
import { useWorkspaceTabs } from "../lib/workspace-tabs.ts";
import { useState, useEffect, useRef } from "react";
import {ToolSnippet, ToolsApiReference, useToolsCopy} from "../components/ToolsWorkbench";
import { api } from "../lib/api.ts";
import { SecretBanner } from "../lib/actions.tsx";
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
  options?: {sshPort: string; remotePort: string},
): { title: string; file: string; body: string }[] {
  const port = localPort.trim() || "20128";
  const host = publicHost.trim() || "styx.example.com";
  const ssh = sshTarget.trim() || "user@your-vps-ip";
  const sshPort = options?.sshPort ?? "22", remotePort = options?.remotePort ?? port;
  for (const value of [sshPort, remotePort]) if (!/^\d+$/.test(value) || Number(value)<1 || Number(value)>65535) throw new Error("Port must be an integer from 1 to 65535.");
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
          body: `ssh -N ${options ? `-p ${sshPort} ` : ""}-o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -L 127.0.0.1:${port}:127.0.0.1:${remotePort} ${ssh}\n\n# Now point local Claude Code / Codex / OpenCode at:\n# http://127.0.0.1:${port}`,
        },
        {
          title: "Persistent SSH config profile",
          file: "~/.ssh/config",
          body: `Host styx-tunnel\n  HostName ${ssh.includes("@") ? ssh.split("@")[1] : ssh}\n${ssh.includes("@") ? `  User ${ssh.split("@")[0]}\n` : ""}  ExitOnForwardFailure yes\n  Port ${sshPort}\n  LocalForward 127.0.0.1:${port} 127.0.0.1:${remotePort}\n  ServerAliveInterval 30\n  ServerAliveCountMax 3\n\n# Connect with: ssh -N styx-tunnel (Ctrl-C to stop)`,
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

import {useFilterQuery} from "../lib/filter-query";
export function Tools() {
 const t=useToolsCopy(),tr=useTranslator();
 const confirmation=useConfirmation();const reviewLock=useRef(false);const intentVersion=useRef(0);
 const query=useFilterQuery({tab:["harnesses","tunnels","endpoints"],client:ALL_TOOLS.map(c=>c.id),tunnel:TUNNEL_MODES.map(m=>m.id),example:Array.from({length:30},(_,i)=>String(i))},{tab:"harnesses",client:"claude-code",tunnel:"ssh",example:"0"});
 const tab=query.values.tab,tool=query.values.client as AnyToolId,tunnel=query.values.tunnel as TunnelModeId;
 const tabs=useWorkspaceTabs(tab);const [search,setSearch]=useState("");
 const [base,setBase]=useState(()=>location.origin),[key,setKey]=useState(""),[model,setModel]=useState("");
 const [localPort, setLocalPort] = useState("20128");
 const [publicHost,setPublicHost]=useState("styx.example.com"),[sshUser,setSshUser]=useState("user"),[sshHost,setSshHost]=useState("host.example"),[sshPort,setSshPort]=useState("22"),[remotePort,setRemotePort]=useState("20128");
 const [fresh,setFresh]=useState<{title:string;key:string}|null>(null),[keyBusy,setKeyBusy]=useState(false),[keyError,setKeyError]=useState("");const keyLock=useRef(false);
 const [probing,setProbing]=useState(false),[probeResult,setProbeResult]=useState<{ok:boolean;status:number;latencyMs:number;reply:string;target:string;model:string}|null>(null);
 const probe=useRef<AbortController|null>(null);
 useEffect(()=>{intentVersion.current++;return()=>{intentVersion.current++;};},[base,key,model,tool,tab]);
 useEffect(()=>{probe.current?.abort();probe.current=null;setProbing(false);setProbeResult(null);return ()=>{probe.current?.abort();probe.current=null;};},[base,key,model,tool,tab]);
 const models=useFetch<{data?:CatalogOption[]}>("/v1/models?configuredOnly=true&prefix=canonical");const catalog=models.status==="ok"?models.data.data??[]:[];
 const shownModel=model.trim()||catalog[0]?.id||"",active=ALL_TOOLS.find(c=>c.id===tool)!;
 let normalized="",validation="";try{if(!base.trim())throw new Error(t("Router base URL is required.","URL dasar router wajib diisi."));normalized=normalizeRouterBase(base);}catch{validation=t("Enter an HTTP(S) URL without credentials, query or fragment.","Masukkan URL HTTP(S) tanpa kredensial, kueri, atau fragmen.");}
 let snippets:ReturnType<typeof buildSnippets>=[],secretSnippets:ReturnType<typeof buildSnippets>=[];
 if(!validation){snippets=buildSnippets(tool,normalized,"YOUR_STYX_KEY",shownModel||"provider/model-id");if(key.trim())secretSnippets=buildSnippets(tool,normalized,key.trim(),shownModel||"provider/model-id");}
 let tunnelSnippets:ReturnType<typeof buildTunnelSnippets>=[],tunnelError="";
 try{tunnelSnippets=buildTunnelSnippets(tunnel,localPort,publicHost,`${sshUser}@${sshHost}`,{sshPort,remotePort});}catch(e){tunnelError=String((e as Error).message);}
 const example=Math.min(Number(query.values.example),Math.max(0,(tab==="tunnels"?tunnelSnippets:snippets).length-1));
 async function makeKey(){if(keyLock.current||reviewLock.current)return;keyLock.current=true;const target={name:active.name.slice(0,40)},version=intentVersion.current;const accepted=await confirmation.confirm({title:t("Create client API key?","Buat kunci API klien?"),description:t("Creates a credential for this client. Save it securely.","Membuat kredensial untuk klien ini. Simpan dengan aman."),resource:active.name,action:t("Create key","Buat kunci"),danger:true});if(!accepted||version!==intentVersion.current){keyLock.current=false;return;}setKeyBusy(true);setKeyError("");try{const made=await api.post<{key:string;name:string}>("/api/keys",target);setKey(made.key);setFresh({title:t("New client API key","Kunci API klien baru"),key:made.key});await api.get("/api/keys");}catch{setKeyError(t("Outcome unknown; reload Client API Keys to reconcile before creating another key.","Hasil belum diketahui; muat ulang Kunci API Klien sebelum membuat kunci lain."));}finally{keyLock.current=false;setKeyBusy(false);}}
 async function runProbe(){
  if(probe.current||reviewLock.current||validation||!key.trim()||!shownModel)return;
  const target=`${normalized}/v1/chat/completions`,selected=shownModel;
  reviewLock.current=true;const version=intentVersion.current;
  const accepted=await confirmation.confirm({title:t("Send real router request?","Kirim permintaan router sungguhan?"),description:t("Usage may incur real charges. This does not certify the native client.","Penggunaan dapat menimbulkan biaya nyata. Ini bukan sertifikasi klien asli."),resource:`POST ${target} · ${selected}`,action:t("Send request","Kirim permintaan"),danger:true});
  reviewLock.current=false;if(!accepted||version!==intentVersion.current)return;
  const controller=new AbortController();probe.current=controller;setProbing(true);setProbeResult(null);const started=performance.now();
  const redact=(v:unknown)=>String(v).split(key.trim()).join("[REDACTED]").slice(0,2000);
  try{const res=await fetch(target,{method:"POST",redirect:"error",signal:controller.signal,headers:{Authorization:`Bearer ${key.trim()}`,"Content-Type":"application/json"},body:JSON.stringify({model:selected,messages:[{role:"user",content:"Reply with the word ok."}],max_tokens:16})});const payload=await res.json().catch(()=>null);if(probe.current!==controller)return;setProbeResult({ok:res.ok,status:res.status,latencyMs:Math.round(performance.now()-started),target,model:selected,reply:redact(res.ok?payload?.choices?.[0]?.message?.content??"(empty response)":payload?.error?.message??res.statusText)});}catch{if(probe.current===controller)setProbeResult({ok:false,status:0,latencyMs:Math.round(performance.now()-started),target,model:selected,reply:t("Request failed; outcome unknown. No automatic retry.","Permintaan gagal; hasil belum diketahui. Tidak diulang otomatis.")});}finally{if(probe.current===controller){probe.current=null;setProbing(false);}}
 }
 const groups=[{en:"Coding agents",id:"Agen pemrograman",ids:["claude-code","codex","opencode","aider","hermes-agent","factory-droid","goose"]},{en:"Editors & SDKs",id:"Editor & SDK",ids:["ide","python"]},{en:"HTTP recipes",id:"Resep HTTP",ids:["curl"]}];
 const filtered=ALL_TOOLS.filter(c=>(c.name+" "+c.summary).toLowerCase().includes(search.toLowerCase()));
 const names=[["harnesses",t("Connect client","Hubungkan klien")],["tunnels",t("Network access","Akses jaringan")],["endpoints",t("API reference","Referensi API")]];
 const chooseExample=(list:typeof snippets)=><label className="tools-field">{t("Example","Contoh")}<select value={example} onChange={e=>query.commit({example:e.target.value})}>{list.map((s,i)=><option key={i} value={i}>{tr(s.title)}</option>)}</select></label>;
 return <div className="page tools-page">{confirmation.dialog}<header className="section-head"><div><h1>{tr("Connect tools")}</h1><p className="muted">{t("Configure a client. Review before copying or sending a request.","Konfigurasikan klien. Tinjau sebelum menyalin atau mengirim permintaan.")}</p></div></header>
 <div className="tabs tools-workspace-tabs" role="tablist" aria-label={t("Integration mode","Mode integrasi")} onKeyDown={tabs.onKeyDown}>{names.map(([id,label])=><button type="button" key={id} role="tab" {...tabs.tabProps(id!)} aria-selected={tab===id} className={tab===id?"tab tools-tab active":"tab tools-tab"} onClick={()=>query.commit({tab:id!,example:"0"})}>{label}</button>)}</div>
 <div {...tabs.panelProps}>
 {tab==="harnesses"&&<><section className="tools-client-choice"><h2>{t("Choose client","Pilih klien")}</h2><div className="tools-picker-grid"><label className="tools-field">{t("Search clients","Cari klien")}<input type="search" value={search} onChange={e=>setSearch(e.target.value)}/></label><label className="tools-field">{t("Client tools","Alat klien")}<select value={tool} onChange={e=>query.commit({client:e.target.value,example:"0"})}>{!filtered.some(c=>c.id===tool)&&<option value={tool}>{active.name}</option>}{groups.map(g=><optgroup key={g.en} label={t(g.en,g.id)}>{filtered.filter(c=>g.ids.includes(c.id)).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>)}</select></label></div>{filtered.length===0&&<p role="status">{t("No matching clients","Tidak ada klien yang cocok")}</p>}<p className="muted"><strong>{active.name}</strong> · {active.badge}</p></section>
 <div className="tools-connection-workbench"><section className="tools-settings"><h2>{t("Connection settings","Pengaturan koneksi")}</h2><label className="tools-field">{t("Router base URL","URL dasar router")}<input required aria-invalid={!!validation} aria-describedby="tools-url-status" value={base} onChange={e=>setBase(e.target.value)} placeholder="http://127.0.0.1:20128"/></label><p id="tools-url-status" role={validation?"alert":"status"} className={validation?"bad":"muted"}>{validation||t("Valid URL format · Not live verified. Recipes normalize /v1 for the selected protocol.","Format URL valid · Belum diverifikasi langsung. Resep menyesuaikan /v1 untuk protokol yang dipilih.")}</p>
 <label className="tools-field">{t("Client API key","Kunci API klien")}<input type="password" autoComplete="off" value={key} onChange={e=>setKey(e.target.value)}/><small>{t("Kept in this page only. Preview always uses a placeholder.","Hanya di halaman ini. Pratinjau selalu memakai placeholder.")}</small></label><button type="button" className="btn-ghost" disabled={keyBusy} onClick={()=>void makeKey()}>{keyBusy?t("Creating…","Membuat…"):t(`Generate key for ${active.name}`,`Buat kunci untuk ${active.name}`)}</button>{fresh&&<SecretBanner title={fresh.title} secret={fresh.key} onDismiss={()=>setFresh(null)}/ >}{keyError&&<p role="alert">{keyError}</p>}
 <ModelPicker label={t("Target model","Model tujuan")} value={model} onChange={setModel} catalog={catalog}/><ReadFreshness state={models}/><p className="muted tools-model-source">{t("Source: configured canonical /v1/models catalog. Metadata is not an availability guarantee. Manual IDs are accepted.","Sumber: katalog kanonis /v1/models terkonfigurasi. Metadata bukan jaminan ketersediaan. ID manual diterima.")}</p>{shownModel&&<p className="tools-model-id"><strong>{t("Effective model: ","Model efektif: ")}</strong><code>{shownModel}</code></p>}
 <div className="tools-request-test"><h3>{t("Router request test","Uji permintaan router")}</h3><p className="muted">POST /v1/chat/completions · {t("May incur real charges. Not native-client certification.","Dapat menimbulkan biaya nyata. Bukan sertifikasi klien asli.")}</p><button type="button" className="btn-add" disabled={probing||!!validation||!key.trim()||!shownModel} onClick={()=>void runProbe()}>{probing?t("Sending…","Mengirim…"):t("Router request test","Uji permintaan router")}</button>{probing&&<button type="button" className="btn-ghost" onClick={()=>{probe.current?.abort();probe.current=null;setProbing(false);}}>{t("Cancel request · outcome may be unknown","Batalkan permintaan · hasil mungkin belum diketahui")}</button>}
 {probeResult&&<div role="status"><strong>{probeResult.ok?t("Router request succeeded","Permintaan router berhasil"):t("Router request failed","Permintaan router gagal")}</strong><p><code>{probeResult.target}</code></p><code>{probeResult.model} · HTTP {probeResult.status||"NETWORK"} · {probeResult.latencyMs}ms</code><pre className="tools-probe-reply">{probeResult.reply}</pre></div>}</div></section>
 <section className="tools-output"><h2>{t("Configuration preview","Pratinjau konfigurasi")}</h2><p className="muted">{t("Generated, not executed. Shell examples: bash / zsh only. Back up and merge required fields; never overwrite an existing configuration file.","Dibuat, tidak dijalankan. Contoh shell: bash / zsh saja. Cadangkan dan gabungkan bidang yang diperlukan; jangan timpa berkas konfigurasi yang ada.")}</p>{!!snippets.length&&chooseExample(snippets)}{snippets[example]&&<ToolSnippet {...snippets[example]!} title={tr(snippets[example]!.title)} secretBody={secretSnippets[example]?.body??""}/>}</section></div></>}
 {tab==="tunnels"&&<section className="tools-network"><h2>{t("Network access","Akses jaringan")}</h2><p className="muted">{t("Recipes only · connection not verified. Nothing is installed or executed.","Hanya resep · koneksi belum diverifikasi. Tidak ada yang dipasang atau dijalankan.")}</p><label className="tools-field">{t("Connection scenario","Skenario koneksi")}<select value={tunnel==="local"?"local":tunnel==="ssh"?"ssh":tunnel==="tailscale"?"private":"public"} onChange={e=>query.commit({tunnel:e.target.value==="private"?"tailscale":e.target.value==="public"?"cloudflared":e.target.value,example:"0"})}><option value="local">{t("Same machine","Mesin yang sama")}</option><option value="ssh">{t("SSH to remote router","SSH ke router jarak jauh")}</option><option value="private">{t("Private tailnet","Tailnet privat")}</option><option value="public">{t("Public HTTPS","HTTPS publik")}</option></select></label><label className="tools-field">{t("Tunnel recipe","Resep tunnel")}<select value={tunnel} onChange={e=>query.commit({tunnel:e.target.value,example:"0"})}>{TUNNEL_MODES.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label><div className="tools-network-grid"><label className="tools-field">{t("Local StyxRouter port","Port StyxRouter lokal")}<input value={localPort} placeholder="20128" onChange={(e) => setLocalPort(e.target.value)}/></label>{tunnel==="ssh"&&<><label className="tools-field">{t("SSH user","Pengguna SSH")}<input value={sshUser} onChange={e=>setSshUser(e.target.value)}/></label><label className="tools-field">{t("SSH host","Host SSH")}<input value={sshHost} onChange={e=>setSshHost(e.target.value)}/></label><label className="tools-field">{t("SSH port","Port SSH")}<input value={sshPort} onChange={e=>setSshPort(e.target.value)}/></label><label className="tools-field">{t("Remote router port","Port router jarak jauh")}<input value={remotePort} onChange={e=>setRemotePort(e.target.value)}/></label></>}{!["local","ssh"].includes(tunnel)&&<label className="tools-field">{t("Public / Tailnet hostname","Hostname publik / tailnet")}<input value={publicHost} onChange={e=>setPublicHost(e.target.value)}/></label>}</div><p className="muted">{t("Keep authentication enabled; protect admin routes before public exposure. Private Serve is not public Funnel. Cursor cloud relay cannot reach loopback or private Serve.","Tetap aktifkan autentikasi; lindungi rute admin sebelum paparan publik. Serve privat bukan Funnel publik. Relay cloud Cursor tidak dapat menjangkau loopback atau Serve privat.")}</p>{tunnelError?<p role="alert" className="bad">{tunnelError}</p>:<><button type="button" className="btn-ghost" onClick={()=>{setBase(TUNNEL_MODES.find(m=>m.id===tunnel)!.recommendedBase(localPort.trim()||"20128",publicHost));query.commit({tab:"harnesses",example:"0"});}}>{t("Use recommended base in client settings","Gunakan URL dasar di pengaturan klien")}</button>{chooseExample(tunnelSnippets)}{tunnelSnippets[example]&&<ToolSnippet {...tunnelSnippets[example]!}/>}</>}</section>}
 {tab==="endpoints"&&<ToolsApiReference/>}</div></div>;
}

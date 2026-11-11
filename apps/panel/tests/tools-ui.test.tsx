import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { MemoryRouter } from "react-router-dom";
import { renderToStaticMarkup } from "react-dom/server";

test("normalizes versioned URLs and rejects credential-bearing or non-HTTP URLs", () => {
  for (const base of ["https://router.example/prefix/", "https://router.example/prefix/v1/"]) {
    const body = buildSnippets("codex", base, "key", "model")[0]!.body;
    expect(body).toContain('base_url = "https://router.example/prefix/v1"');
    expect(body).not.toContain("/v1/v1");
  }
  for (const base of ["javascript:alert(1)", "https://user:pass@router.example", "https://router.example/?key=x", "https://router.example/#fragment"]) {
    expect(() => buildSnippets("curl", base, "key", "model")).toThrow();
  }
});

test("shell snippets preserve hostile input literally without command execution", () => {
  const key = `key'\"$HOME\\\`$(printf INJECTED)`;
  const model = `model'\"\\\n$(printf INJECTED)`;
  const snippets = buildSnippets("claude-code", "https://router.example/v1/", key, model);
  const shell = snippets[0]!.body.replace(/\nclaude$/, '\nprintf \'%s\\n%s\\n%s\' "$ANTHROPIC_BASE_URL" "$ANTHROPIC_AUTH_TOKEN" "$ANTHROPIC_MODEL"');
  const result = spawnSync("bash", ["-c", shell], { encoding: "utf8" });
  expect(result.status).toBe(0);
  expect(result.stdout).toBe(`https://router.example\n${key}\n${model}`);
});
import { ALL_TOOLS, buildSnippets, buildTunnelSnippets, Tools, TOOLS, TUNNEL_MODES } from "../src/pages/Tools.tsx";

test("invalid base URL renders a recoverable validation error, not a page crash", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "location");
  Object.defineProperty(globalThis, "location", { configurable: true, value: { origin: "https://", port: "", hostname: "localhost" } });
  try {
    const html = renderToStaticMarkup(<MemoryRouter><Tools /></MemoryRouter>);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Router base URL");
    expect(html).toMatch(/disabled="">Router request test/);
    expect(html).not.toContain("tools-snippet-body");
  } finally {
    if (previous) Object.defineProperty(globalThis, "location", previous);
    else Reflect.deleteProperty(globalThis, "location");
  }
});

test("harness schemas follow current official contracts without conflating unrelated agents", () => {
  const hermes = buildSnippets("hermes-agent", "https://router.example", "key", "model");
  expect(hermes[0]!.body).toContain('default: "model"');
  expect(hermes[0]!.body).toContain('key_env: STYX_API_KEY');
  expect(hermes.map(s => s.body).join("\n")).not.toContain("api_key_env");
  expect(hermes[1]!.body).toContain("hermes config set model.base_url");
  expect(hermes[1]!.body).not.toContain("echo ");
  const factory = buildSnippets("factory-droid", "https://router.example", "key", "model");
  expect(factory[0]!.file).toBe("~/.factory/settings.json");
  expect(JSON.parse(factory[0]!.body).customModels[0]).toEqual({ model: "model", displayName: "Styx (model)", baseUrl: "https://router.example/v1", apiKey: "${STYX_API_KEY}", provider: "generic-chat-completion-api" });
  const goose = buildSnippets("goose", "https://router.example/prefix/v1", "key", "model")[0]!.body;
  expect(goose).toContain("OPENAI_HOST='https://router.example'");
  expect(goose).toContain("OPENAI_BASE_PATH='prefix/v1/chat/completions'");
  expect(goose).not.toContain("OPENAI_BASE_URL");
  expect(ALL_TOOLS.find(t => t.id === "goose")!.name).toBe("Goose");
});

test("tools catalog includes Claude Code, Codex, OpenCode, Aider, IDE, Python SDK and cURL with attached file headers", () => {
  expect(TOOLS.map((t) => t.id)).toEqual([
    "claude-code",
    "codex",
    "opencode",
    "aider",
    "ide",
    "python",
    "curl",
  ]);
  expect(ALL_TOOLS.map((t) => t.id)).toContain("hermes-agent");
  expect(ALL_TOOLS.map((t) => t.id)).toContain("factory-droid");
  expect(ALL_TOOLS.map((t) => t.id)).toContain("goose");
  const py = buildSnippets("python", "http://127.0.0.1:20128", "sk-test", "antigravity/gemini-4-argon-high");
  expect(py[0]?.file).toBe("main.py");
  expect(py[0]?.body).toContain("http://127.0.0.1:20128/v1");
  expect(py[0]?.body).toContain("antigravity/gemini-4-argon-high");
  const hermes = buildSnippets("hermes-agent", "http://127.0.0.1:20128", "sk-test", "codex/gpt-5.4");
  expect(hermes[0]?.file).toBe("~/.hermes/config.yaml");
  expect(hermes[0]?.body).toContain("http://127.0.0.1:20128/v1");
});

test("blank tunnel ports use the documented public default", () => {
  for (const mode of TUNNEL_MODES) {
    for (const port of ["", "   "]) {
      const snippets = buildTunnelSnippets(mode.id, port, "styx.example.org", "user@example.org");
      expect(snippets.map(s => s.body).join("\n")).toContain("127.0.0.1:20128");
    }
  }
});

test("backend port input is independent of the browser reverse-proxy port", () => {
  const source = readFileSync(new URL("../src/pages/Tools.tsx", import.meta.url), "utf8");
  expect(source).not.toContain("location.port");
  expect(source).toContain('const [localPort, setLocalPort] = useState("20128")');
  expect(source).toContain('placeholder="20128"');
  expect(source).toContain('onChange={(e) => setLocalPort(e.target.value)}');
  expect(source).toContain('[sshHost,setSshHost]=useState("host.example")');
  expect(source).toContain('recommendedBase(localPort.trim()||"20128",publicHost)');
});

test("custom backend ports remain usable across all tunnel modes", () => {
  for (const mode of TUNNEL_MODES) {
    const snippets = buildTunnelSnippets(mode.id, " 31234 ", "styx.example.org", "user@203.0.113.5");
    expect(snippets.map(s => s.body).join("\n")).toContain("127.0.0.1:31234");
  }
});

test("tunnel validation blocks syntax injection and documents TLS and streaming prerequisites", () => {
  for (const port of ["0", "65536", "42;id", "22\nHost evil", "1.5"]) {
    expect(() => buildTunnelSnippets("ssh", port, "styx.example.com", "user@host")).toThrow();
  }
  for (const host of ["https://host", "host/path", "host\n}", "-evil", "host:443"]) {
    expect(() => buildTunnelSnippets("caddy", "20128", host, "user@host")).toThrow();
  }
  for (const target of ["-oProxyCommand=id", "user@host;id", "host\nProxyCommand id"]) {
    expect(() => buildTunnelSnippets("ssh", "20128", "styx.example.com", target)).toThrow();
  }
  const cf = buildTunnelSnippets("cloudflared", "20128", "styx.example.com", "user@host");
  expect(cf[0]!.body).toContain("do not support SSE");
  expect(cf.map(s => s.body).join("\n")).toContain("TUNNEL_UUID");
  expect(cf.map(s => s.body).join("\n")).not.toContain("/root/");
  const tls = buildTunnelSnippets("caddy", "20128", "styx.example.com", "user@host");
  expect(tls[1]!.body).toContain("ssl_certificate ");
  expect(tls[1]!.body).toContain("ssl_certificate_key ");
  expect(tls[1]!.body).toContain("nginx -t");
  const tail = buildTunnelSnippets("tailscale", "20128", "styx.example.com", "user@host");
  expect(tail[0]!.body).toContain("tailscale serve status");
  expect(tail[1]!.body).toContain("PUBLIC");
});

test("tunnel modes generate SSH port-forward, Cloudflare Tunnel, Tailscale, and Caddy SSE snippets", () => {
  expect(TUNNEL_MODES.map((m) => m.id)).toEqual(["local", "ssh", "cloudflared", "tailscale", "caddy"]);
  const ssh = buildTunnelSnippets("ssh", "20128", "styx.example.com", "ubuntu@203.0.113.5");
  expect(ssh[0]?.body).toContain("-L 127.0.0.1:20128:127.0.0.1:20128 ubuntu@203.0.113.5");
  const cf = buildTunnelSnippets("cloudflared", "20128", "styx.example.com", "ubuntu@203.0.113.5");
  expect(cf[0]?.body).toContain("cloudflared tunnel --url http://127.0.0.1:20128");
  const caddy = buildTunnelSnippets("caddy", "20128", "styx.example.com", "ubuntu@203.0.113.5");
  expect(caddy[0]?.body).toContain("flush_interval -1");
});

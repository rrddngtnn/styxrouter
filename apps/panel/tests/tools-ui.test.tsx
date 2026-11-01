import { expect, test } from "bun:test";
import { ALL_TOOLS, buildSnippets, buildTunnelSnippets, TOOLS, TUNNEL_MODES } from "../src/pages/Tools.tsx";

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

test("tunnel modes generate SSH port-forward, Cloudflare Tunnel, Tailscale, and Caddy SSE snippets", () => {
  expect(TUNNEL_MODES.map((m) => m.id)).toEqual(["local", "ssh", "cloudflared", "tailscale", "caddy"]);
  const ssh = buildTunnelSnippets("ssh", "20128", "styx.example.com", "ubuntu@203.0.113.5");
  expect(ssh[0]?.body).toContain("-L 20128:127.0.0.1:20128 ubuntu@203.0.113.5");
  const cf = buildTunnelSnippets("cloudflared", "20128", "styx.example.com", "ubuntu@203.0.113.5");
  expect(cf[0]?.body).toContain("cloudflared tunnel --url http://127.0.0.1:20128");
  const caddy = buildTunnelSnippets("caddy", "20128", "styx.example.com", "ubuntu@203.0.113.5");
  expect(caddy[0]?.body).toContain("flush_interval -1");
});

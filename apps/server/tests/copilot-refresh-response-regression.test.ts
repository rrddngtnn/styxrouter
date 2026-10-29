import { test, expect } from "bun:test";
import { GithubExecutor } from "../open-sse/executors/github.ts";
import { GheCopilotExecutor } from "../open-sse/executors/ghe-copilot.ts";

for (const [name, executor, credentials] of [
  ["GitHub", new GithubExecutor(), undefined],
  ["GHE", new GheCopilotExecutor(), { providerSpecificData: { gheUrl: "https://enterprise.example" } }],
] as const) {
  test(`${name} rejects malformed successful token responses`, async () => {
    const original = globalThis.fetch;
    try {
      globalThis.fetch = (async () => Response.json({ error: "bad credentials" })) as typeof fetch;
      expect(await executor.refreshCopilotToken("access", undefined, credentials)).toBeNull();
      expect(await executor.refreshGitHubToken("refresh", undefined, credentials)).toBeNull();
    } finally { globalThis.fetch = original; }
  });
  test(`${name} accepts valid tokens and preserves refresh fallback`, async () => {
    const original = globalThis.fetch;
    try {
      globalThis.fetch = (async () => Response.json({ token: "copilot", expires_at: 123, endpoints: { api: "https://api.example", proxy: "https://proxy.example" } })) as typeof fetch;
      expect(await executor.refreshCopilotToken("access", undefined, credentials)).toMatchObject({ token: "copilot", expiresAt: 123 });
      globalThis.fetch = (async () => Response.json({ access_token: "new", expires_in: 60 })) as typeof fetch;
      expect(await executor.refreshGitHubToken("refresh", undefined, credentials)).toEqual({ accessToken: "new", refreshToken: "refresh", expiresIn: 60 });
    } finally { globalThis.fetch = original; }
  });
}

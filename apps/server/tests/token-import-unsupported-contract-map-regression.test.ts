import { expect, test } from "bun:test";
import { prepareTokenImport, tokenImportProviders } from "../server/tokenImport.ts";

test("unsupported providers expose their distinct credential contracts without accepting credentials", () => {
  const contracts: Record<string, [string, string[]]> = {
    lmarena: ["web-session", ["cookies"]],
    "claude-web": ["web-session", ["sessionKey", "organizationId"]],
    "gemini-web": ["web-session", ["cookies"]],
    "chatgpt-web-codex": ["web-session", ["cookies or browser storage state", "optional runtime key"]],
    github: ["token-exchange", ["GitHub token", "Copilot token exchange"]],
    antigravity: ["oauth-project", ["access token", "Google Cloud project"]],


    zcode: ["local-cli", ["local CLI session"]],
    auggie: ["local-cli", ["local CLI session"]],
    "codex-app-server": ["local-cli", ["local CLI session"]],
  };
  const entries = new Map(tokenImportProviders().map(entry => [entry.id, entry]));
  for (const [id, [credentialFormat, requiredData]] of Object.entries(contracts)) {
    expect(entries.get(id)).toMatchObject({ supported: false, credentialFormat, requiredData, reason: expect.any(String) });
    const result = prepareTokenImport({ provider: id, accounts: { access_token: "synthetic-secret" } })![0].view;
    expect(result.valid).toBe(false);
    expect(JSON.stringify(result)).not.toContain("synthetic-secret");
  }
});

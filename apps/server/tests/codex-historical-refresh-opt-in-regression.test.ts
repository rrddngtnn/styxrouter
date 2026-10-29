import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { normalizeCodexImportRecord } from "../src/lib/oauth/services/codexImport.ts";
import { refreshCodexToken, refreshAccessToken } from "../open-sse/services/tokenRefresh.ts";

test("explicit Codex refresh freeze blocks unmarked historical credentials, but is reversible for OAuth", async () => {
  const old = process.env.STYX_BLOCK_CODEX_REFRESH;
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return Response.json({ access_token: "synthetic-new-access", refresh_token: "synthetic-new-refresh", expires_in: 3600 }); }) as typeof fetch;
  try {
    const imported = normalizeCodexImportRecord({ email: "synthetic@example.test", access_token: "synthetic-access", refresh_token: "synthetic-refresh" });
    if (!imported.ok) throw new Error("synthetic historical payload invalid");
    expect((imported.payload.providerSpecificData as any)?.importedToken).toBeUndefined();
    process.env.STYX_BLOCK_CODEX_REFRESH = "1";
    await expect(refreshCodexToken(imported.payload.refreshToken, null)).rejects.toThrow(/Codex.*refresh.*disabled/i);
    await expect(refreshAccessToken("codex", imported.payload.refreshToken, imported.payload, null)).rejects.toThrow(/Codex.*refresh.*disabled/i);
    await expect(refreshCodexToken("synthetic-legitimate-oauth-refresh", null)).rejects.toThrow(/Codex.*refresh.*disabled/i);
    expect(calls).toBe(0);
    delete process.env.STYX_BLOCK_CODEX_REFRESH;
    expect((await refreshCodexToken("synthetic-legitimate-oauth-refresh", null))?.refreshToken).toBe("synthetic-new-refresh");
    expect(calls).toBe(1);
  } finally {
    if (old === undefined) delete process.env.STYX_BLOCK_CODEX_REFRESH; else process.env.STYX_BLOCK_CODEX_REFRESH = old;
    globalThis.fetch = original;
  }
});

test("two independent processes with freeze cannot rotate a historical refresh token", async () => {
  const script = `
    import { refreshCodexToken } from './open-sse/services/tokenRefresh.ts';
    globalThis.fetch = async () => { console.log('UPSTREAM_CALLED'); return Response.json({access_token:'new',refresh_token:'rotated'}); };
    try { await refreshCodexToken('synthetic-historical-refresh', null); console.log('UNEXPECTED_SUCCESS'); process.exitCode=1; }
    catch (e) { if (!String(e).includes('Codex refresh is disabled')) process.exitCode=1; else console.log('BLOCKED'); }
  `;
  const run = () => new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", script], { cwd: `${import.meta.dir}/..`, env: { ...process.env, STYX_BLOCK_CODEX_REFRESH: "1" }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", data => output += data);
    child.stderr.on("data", data => output += data);
    child.on("error", reject);
    child.on("close", code => resolve({ code, output }));
  });
  for (const result of await Promise.all([run(), run()])) {
    expect(result.code).toBe(0);
    expect(result.output).toContain("BLOCKED");
    expect(result.output).not.toContain("UPSTREAM_CALLED");
  }
});

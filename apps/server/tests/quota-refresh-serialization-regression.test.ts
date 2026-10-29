import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

const dataDir = mkdtempSync(join(process.env.TMPDIR!, "styx-quota-serialization-"));
process.env.DATA_DIR = dataDir;
process.env.STYX_TEST_MODE = "1";
process.env.CODEX_REFRESH_SPACING_MS = "0";
const { createProviderConnection, getProviderConnectionById } = await import("../src/lib/db/providers");
const { refreshAndUpdateCredentials } = await import("../src/lib/usage/providerLimits");
afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

for (const provider of ["claude", "kimi-coding", "codex"]) {
  test(`${provider} quota refresh serializes sibling requests without deadlock`, async () => {
    const connections = await Promise.all([0, 1].map(i => createProviderConnection({
      provider, name: `${provider}-${i}`, authType: "oauth", accessToken: `old-access-${i}`, refreshToken: `${provider}-old-refresh-${i}`,
    })));
    const originalFetch = globalThis.fetch;
    let active = 0, maxActive = 0, calls = 0;
    globalThis.fetch = (async (_input, init) => {
      const token = new URLSearchParams(String(init?.body)).get("refresh_token");
      active++;
      maxActive = Math.max(maxActive, active);
      calls++;
      await new Promise(resolve => setTimeout(resolve, 30));
      active--;
      return new Response(JSON.stringify({ access_token: `new-${token}`, refresh_token: `rotated-${token}`, expires_in: 3600 }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const results = await Promise.race([
        Promise.all(connections.map(connection => refreshAndUpdateCredentials(connection as any, { allowRotatingRefresh: true, force: true }))),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${provider} refresh deadlocked`)), 2000); }),
      ]);
      expect(results.every(result => result.refreshed)).toBe(true);
      expect(calls).toBe(2);
      expect(maxActive).toBe(1);
      for (const connection of connections) {
        const stored = await getProviderConnectionById(connection.id);
        expect(stored?.refreshToken).toBe(`rotated-${connection.refreshToken}`);
        expect(stored?.accessToken).toBe(`new-${connection.refreshToken}`);
      }
    } finally {
      clearTimeout(timer);
      globalThis.fetch = originalFetch;
    }
  }, 5000);
}

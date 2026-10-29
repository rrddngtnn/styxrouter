import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

// Set before loading the database modules; never touch the user's data.
const dataDir = mkdtempSync(join(process.env.TMPDIR || "/tmp", "styx-quota-refresh-"));
process.env.DATA_DIR = dataDir;
process.env.STYX_TEST_MODE = "1";
process.env.CODEX_REFRESH_SPACING_MS = "0";
const { createProviderConnection, getProviderConnectionById } = await import("../src/lib/db/providers");
const { refreshAndUpdateCredentials } = await import("../src/lib/usage/providerLimits");
afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

test("Codex quota refresh completes and persists rotated credentials", async () => {
  const connection = await createProviderConnection({ provider: "codex", name: "test", authType: "oauth", accessToken: "old-access", refreshToken: "old-refresh" });
  const originalFetch = globalThis.fetch;
  let called = 0;
  globalThis.fetch = (async () => {
    called++;
    return new Response(JSON.stringify({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const result = await Promise.race([
      refreshAndUpdateCredentials(connection as any, { allowRotatingRefresh: true, force: true }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("refresh deadlocked")), 1000)),
    ]);
    expect(result.refreshed).toBe(true);
    expect(called).toBe(1);
    const stored = await getProviderConnectionById(connection.id);
    expect(stored?.accessToken).toBe("new-access");
    expect(stored?.refreshToken).toBe("new-refresh");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

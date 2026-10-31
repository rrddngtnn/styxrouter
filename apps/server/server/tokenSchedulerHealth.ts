// Process-local scheduler observations; never include credentials or error text.
export const tokenSchedulerHealth: {
  enabled: boolean; running: boolean; lastStartedAt: number | null; lastFinishedAt: number | null;
  lastOutcome: "completed" | "failed" | null; lastDueCount: number | null;
  lastRefreshedCount: number | null; nextScheduledAt: number | null;
} = { enabled: false, running: false, lastStartedAt: null, lastFinishedAt: null,
  lastOutcome: null, lastDueCount: null, lastRefreshedCount: null, nextScheduledAt: null };

let tokenHealthPassGeneration = 0;
let activeTokenHealthPasses = 0;

export async function executeTokenHealthPass(options?: { allowInTestMode?: boolean }): Promise<{
  checked: number;
  refreshed: number;
}> {
  const disabled =
    process.env.STYX_DISABLE_TOKEN_HEALTHCHECK === "1" ||
    process.env.STYX_DISABLE_TOKEN_HEALTHCHECK === "true" ||
    (!options?.allowInTestMode && (process.env.STYX_TEST_MODE === "1" || Boolean(process.env.BUN_TEST)));
  if (disabled) return { checked: 0, refreshed: 0 };

  const generation = ++tokenHealthPassGeneration;
  activeTokenHealthPasses++;
  tokenSchedulerHealth.running = true;
  tokenSchedulerHealth.lastStartedAt = Date.now();
  tokenSchedulerHealth.lastFinishedAt = null;
  tokenSchedulerHealth.lastOutcome = null;
  tokenSchedulerHealth.lastDueCount = null;
  tokenSchedulerHealth.lastRefreshedCount = null;
  let checked = 0;
  let refreshed = 0;
  try {
    const { getProviderConnections } = await import("../src/lib/db/providers.ts");
    const { getAccessToken, getRefreshLeadMs, TOKEN_EXPIRY_BUFFER_MS } = await import(
      "../open-sse/services/tokenRefresh.ts"
    );
    const { updateProviderCredentials } = await import("../src/sse/services/tokenRefresh.ts");

    const connections = await getProviderConnections({ authType: "oauth", isActive: true }, 500, 0);
    for (const conn of connections as any[]) {
      const rawExp = conn.tokenExpiresAt ?? conn.expiresAt ?? null;
      const expiresAt = rawExp ? new Date(rawExp).getTime() : null;
      if (!expiresAt) continue;
      const lead = getRefreshLeadMs(conn.provider);
      if (Date.now() < expiresAt - lead - TOKEN_EXPIRY_BUFFER_MS) continue;

      checked++;
      const result = await getAccessToken(
        conn.provider,
        {
          refreshToken: conn.refreshToken,
          connectionId: conn.id,
          accessToken: conn.accessToken,
          expiresAt: rawExp,
          providerSpecificData: conn.providerSpecificData,
        },
        {
          warn: () => console.warn("[TOKEN-HEALTH] refresh warning"),
          error: () => console.error("[TOKEN-HEALTH] refresh error"),
        },
        null,
        async (persisted) => {
          if (!(await updateProviderCredentials(conn.id, persisted as Record<string, unknown>))) {
            throw new Error("Secure credential persistence failed");
          }
        },
      );
      if (result?.accessToken) refreshed++;
    }
    if (generation === tokenHealthPassGeneration) {
      tokenSchedulerHealth.lastOutcome = "completed";
      tokenSchedulerHealth.lastDueCount = checked;
      tokenSchedulerHealth.lastRefreshedCount = refreshed;
    }
  } catch {
    if (generation === tokenHealthPassGeneration) tokenSchedulerHealth.lastOutcome = "failed";
  } finally {
    activeTokenHealthPasses--;
    tokenSchedulerHealth.running = activeTokenHealthPasses > 0;
    if (generation === tokenHealthPassGeneration) {
      tokenSchedulerHealth.lastFinishedAt = Date.now();
    }
  }
  return { checked, refreshed };
}

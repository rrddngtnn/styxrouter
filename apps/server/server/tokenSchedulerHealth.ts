// Process-local scheduler observations; never include credentials or error text.
export const tokenSchedulerHealth: {
  enabled: boolean; running: boolean; lastStartedAt: number | null; lastFinishedAt: number | null;
  lastOutcome: "completed" | "failed" | null; lastDueCount: number | null;
  lastRefreshedCount: number | null; nextScheduledAt: number | null;
} = { enabled: false, running: false, lastStartedAt: null, lastFinishedAt: null,
  lastOutcome: null, lastDueCount: null, lastRefreshedCount: null, nextScheduledAt: null };

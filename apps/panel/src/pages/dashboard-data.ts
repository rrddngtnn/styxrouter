import { accountProblem, type Connection } from "../lib/types.ts";

/** Summarize observed account checks, never interpret an unchecked account as healthy. */
export function providerHealth(accounts: Connection[], names: Map<string, string>, now: number) {
  const rows = new Map<string, { id: string; name: string; total: number; active: number; healthy: number; unchecked: number; problems: number }>();
  for (const account of accounts) {
    const row = rows.get(account.provider) ?? { id: account.provider, name: names.get(account.provider) ?? account.provider, total: 0, active: 0, healthy: 0, unchecked: 0, problems: 0 };
    row.total++;
    if (account.isActive) {
      row.active++;
      if (accountProblem(account, now)) row.problems++;
      else if (account.testStatus === "active") row.healthy++;
      else row.unchecked++;
    }
    rows.set(account.provider, row);
  }
  return [...rows.values()].sort((a, b) => b.problems - a.problems || a.name.localeCompare(b.name));
}

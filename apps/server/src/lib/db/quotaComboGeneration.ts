import { getDbInstance } from "./core";
import { invalidateDbCache } from "./readCache";

const STATE_KEY = "quota_combo_generation";

export function getQuotaComboGeneration(): number {
  const row = getDbInstance()
    .prepare("SELECT value FROM db_meta WHERE key = ?")
    .get(STATE_KEY) as { value: string } | undefined;
  const generation = Number(row?.value);
  if (!Number.isSafeInteger(generation) || generation < 1) {
    throw new Error("Quota combo generation is unavailable or invalid");
  }
  return generation;
}

let observedGeneration: number | undefined;

/** Read-through recovery for a writer that exited before asynchronous maintenance. */
export async function ensureQuotaCombosCurrent(): Promise<void> {
  for (let attempt = 0; attempt < 32; attempt++) {
    const generation = getQuotaComboGeneration();
    const row = getDbInstance().prepare("SELECT value FROM db_meta WHERE key = 'quota_combo_reconciled_generation'").get() as { value: string } | undefined;
    if (Number(row?.value) === generation) {
      if (observedGeneration !== generation) {
        // A different process may have done both the mutation and recovery.
        // Local TTL caches must not keep the prior generation in that case.
        observedGeneration = generation;
        invalidateDbCache("combos");
      }
      return;
    }
    const { syncQuotaCombos } = await import("../quota/quotaCombos");
    await syncQuotaCombos("read-recovery");
  }
  throw new Error("Quota combo read recovery remained contended");
}


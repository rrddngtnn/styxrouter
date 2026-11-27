type WriteStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const key = 'styx.quota.pool-create.pending.v1';

// Tab-wide fence deliberately blocks all pool creates after an unknown result.
// No account identities, names, credentials, expiry, or inventory-based unlock.
export function poolWriteBlocked(store: WriteStorage | null): boolean {
  try { return !store || store.getItem(key) !== null; } catch { return true; }
}
export function beginPoolWrite(store: WriteStorage | null, attempt: string): boolean {
  if (!store || !attempt || poolWriteBlocked(store)) return false;
  try { store.setItem(key, attempt); return store.getItem(key) === attempt; } catch { return false; }
}
export function settlePoolWrite(store: WriteStorage | null, attempt: string): boolean {
  if (!store || !attempt) return false;
  try {
    if (store.getItem(key) !== attempt) return false;
    store.removeItem(key);
    return store.getItem(key) === null;
  } catch { return false; }
}
export function poolWriteStorage(): WriteStorage | null {
  try { return typeof window === 'undefined' ? null : window.sessionStorage; } catch { return null; }
}

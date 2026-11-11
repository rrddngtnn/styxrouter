export type ConsequentialState = 'idle' | 'pending' | 'reconciling' | 'uncertain';
/** A lost mutation response is not proof of failure. Only explicit reconciliation unlocks it. */
export function createConsequentialOperation(changed: () => void = () => {}) {
 let state: ConsequentialState = 'idle';
 const set = (next: ConsequentialState) => { state = next; changed(); };
 return {
  get state() { return state; },
  async run<T>(write: () => Promise<T>, onDone: () => Promise<void>): Promise<T | undefined> {
   if (state !== 'idle') return undefined;
   set('pending');
   let result: T;
   try { result = await write(); }
   catch { set('uncertain'); try { await onDone(); } catch { /* Keep uncertainty visible. */ } return undefined; }
   set('reconciling');
   try { await onDone(); set('idle'); }
   catch { set('uncertain'); }
   return result;
  },
  async reconcile(read: () => Promise<void>) {
   if (state !== 'uncertain') return;
   set('reconciling');
   try { await read(); set('idle'); } catch { set('uncertain'); }
  },
 };
}

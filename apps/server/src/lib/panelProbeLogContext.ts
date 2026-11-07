import { AsyncLocalStorage } from "node:async_hooks";

// No request header, model field, or other client-controlled value can enable this.
// Only trusted in-process callers invoking this function can establish the context.
const probeLogContext = new AsyncLocalStorage<boolean>();

export function runWithPanelProbeLogContext<T>(callback: () => T): T {
  return probeLogContext.run(true, callback);
}

export function isPanelProbeLogContext(): boolean {
  return probeLogContext.getStore() === true;
}

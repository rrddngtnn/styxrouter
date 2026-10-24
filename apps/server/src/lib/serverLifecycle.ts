export type ServerLifecyclePhase = "starting" | "ready" | "stopping";

declare global {
  var __styxServerLifecycle: ServerLifecyclePhase | undefined;
}

export function getServerLifecyclePhase(): ServerLifecyclePhase {
  return globalThis.__styxServerLifecycle ?? "starting";
}

export function markServerStarting(): void {
  globalThis.__styxServerLifecycle = "starting";
}

export function markServerReady(): void {
  if (getServerLifecyclePhase() !== "stopping") {
    globalThis.__styxServerLifecycle = "ready";
  }
}

export function markServerStopping(): void {
  globalThis.__styxServerLifecycle = "stopping";
}

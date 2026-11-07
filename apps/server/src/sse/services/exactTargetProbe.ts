import { AsyncLocalStorage } from "node:async_hooks";

const requests = new WeakMap<object, string>();
const context = new AsyncLocalStorage<string>();

/** Mark only an internally constructed request, after management authorization. */
export function markExactTargetProbe(request: Request, target: string): void {
  if (!target || !target.includes("/") || target.startsWith("/") || target.endsWith("/")) {
    throw new Error("Exact probe target must be provider/model");
  }
  requests.set(request, target);
}

export function runWithExactTargetProbe<T>(request: object, fn: () => T): T {
  const target = requests.get(request);
  requests.delete(request);
  return target ? context.run(target, fn) : context.run("", fn);
}

export function exactTargetProbe(): string | undefined {
  return context.getStore() || undefined;
}

import { types } from "node:util";

// This catches native async functions, including bound ones, before they start.
// Ordinary functions can still start asynchronous work or return a thenable;
// detecting that return value cannot cancel work already scheduled by the callback.
export function requireSynchronousCallback(fn: Function): void {
  if (types.isAsyncFunction(fn) || Object.getPrototypeOf(fn) === Object.getPrototypeOf(async function () {})) {
    throw new TypeError("SQLite transaction callbacks must be synchronous");
  }
}

// Transaction callbacks must finish before the driver commits or releases a savepoint.
export function requireSynchronous<T>(value: T): T {
  if (value !== null && (typeof value === "object" || typeof value === "function") &&
      typeof (value as { then?: unknown }).then === "function") {
    // Observe rejection even though the transaction API itself throws synchronously.
    void Promise.resolve(value).catch(() => {});
    throw new TypeError("SQLite transaction callbacks must be synchronous");
  }
  return value;
}

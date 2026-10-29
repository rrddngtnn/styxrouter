// Process-local, bounded diagnostic events. Never retain caller-controlled text.
import { createHmac, randomBytes } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

const key = randomBytes(32);
const LIMIT = 1000;
const instanceId = randomBytes(16).toString("hex");
export function routingTraceScope() {
  return { storage: "process-local", retention: "volatile", maxEvents: LIMIT, instanceId } as const;
}
const reasons = new Set(["excluded", "modelExcluded", "modelNotAdvertised", "rateLimited", "terminalStatus", "codexScopeLimited", "modelLocked", "available", "quotaPolicy", "quotaExhausted", "selected", "routing429", "upstreamHttpHeaders", "upstreamHttpError"]);
type Input = { kind: "selection" | "outcome"; provider: string; account: string; reason: string; cooldownMs?: number; status?: number };
type Event = { time: number; kind: "selection" | "outcome"; provider: string; account: string; reason: string; requestId?: string; cooldownMs?: number; status?: number };
const events: Event[] = [];
const requestContext = new AsyncLocalStorage<string>();
// IDs are freshly generated internally, never derived from request headers or content.
export function withRoutingTraceRequest<T>(callback: () => T): T {
  return requestContext.run(randomBytes(16).toString("hex"), callback);
}
const pseudonym = (value: string) => createHmac("sha256", key).update(value).digest("hex").slice(0, 16);

export function recordRoutingTrace(input: Input): void {
  if (!reasons.has(input.reason) || (input.kind !== "selection" && input.kind !== "outcome")) return;
  const event: Event = { time: Date.now(), kind: input.kind, provider: pseudonym(input.provider), account: pseudonym(input.account), reason: input.reason };
  const requestId = requestContext.getStore();
  if (requestId) event.requestId = requestId;
  if (typeof input.cooldownMs === "number" && Number.isFinite(input.cooldownMs)) event.cooldownMs = Math.max(0, Math.min(input.cooldownMs, 86400000));
  if (Number.isInteger(input.status) && input.status! >= 100 && input.status! <= 599) event.status = input.status;
  if (events.length === LIMIT) events.shift();
  events.push(event);
}
export function readRoutingTrace(): Event[] { return events.map((event) => ({ ...event })); }
export function clearRoutingTrace(): void { events.length = 0; }

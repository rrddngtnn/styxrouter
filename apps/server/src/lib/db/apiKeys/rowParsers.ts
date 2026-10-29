/**
 * db/apiKeys/rowParsers.ts — pure column parsers for persisted api_keys rows.
 *
 * Extracted verbatim from db/apiKeys.ts (god-file decomposition): the family of
 * functions that coerce raw SQLite column values (JSON strings, 0/1 flags, nullable
 * timestamps) into the typed shapes the host hydrates rows with. Pure — no DB handle,
 * no caches, no side effects — so they live as a co-located leaf. Behavior-preserving
 * move; apiKeys.ts imports them back for getApiKeys/getApiKeyById/getApiKeyMetadata.
 */

import type { AccessSchedule, RateLimitRule } from "./types";
export { parseModelAccessMode } from "./modelAccessMode";
export type { ModelAccessMode } from "./modelAccessMode";

/**
 * Helper function to safely parse allowed_models JSON
 */
export function parseAllowedModels(value: unknown): string[] {
  if (!value || typeof value !== "string" || value.trim() === "") {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

export function parseAllowedCombos(value: unknown): string[] {
  return parseStringList(value);
}

export function parseNoLog(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

export function parseAutoResolve(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

export function parseDisableNonPublicModels(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

export function parseAllowUsageCommand(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

export function parseChaosModeEnabled(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

export function parseIsActive(value: unknown): boolean {
  // DEFAULT 1 — active unless explicitly set to 0
  if (value === 0 || value === "0" || value === false) return false;
  return true;
}

export function parseCompressionEnabled(value: unknown): boolean {
  // DEFAULT 1 — preserve compression for legacy rows unless explicitly disabled.
  if (value === 0 || value === "0" || value === false) return false;
  return true;
}

export function parseAccessSchedule(value: unknown): AccessSchedule | null {
  // Only an absent SQL value means unrestricted; corrupt persisted policy is
  // not equivalent to a deliberately cleared schedule.
  if (value == null) return null;
  try {
    if (typeof value !== "string") throw new Error();
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    const obj = parsed as Record<string, unknown>;
    const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
    if (
      typeof obj.enabled !== "boolean" ||
      typeof obj.from !== "string" || !time.test(obj.from) ||
      typeof obj.until !== "string" || !time.test(obj.until) ||
      !Array.isArray(obj.days) || obj.days.length < 1 || obj.days.length > 7 ||
      obj.days.some((d: unknown) => typeof d !== "number" || !Number.isInteger(d) || d < 0 || d > 6) ||
      typeof obj.tz !== "string" || !obj.tz || obj.tz.length > 100
    ) throw new Error();
    new Intl.DateTimeFormat("en-US", { timeZone: obj.tz });
    return { enabled: obj.enabled, from: obj.from, until: obj.until, days: obj.days, tz: obj.tz };
  } catch {
    throw new Error("Invalid API key access schedule");
  }
}

export function parseRateLimits(value: unknown): RateLimitRule[] | null {
  if (!value || typeof value !== "string" || value.trim() === "") return null;
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(
      (rule: RateLimitRule) =>
        typeof rule === "object" &&
        rule !== null &&
        typeof rule.limit === "number" &&
        typeof rule.window === "number"
    ) as RateLimitRule[];
  } catch {
    return null;
  }
}

/**
 * Helper function to safely parse allowed_connections JSON
 */
export function parseAllowedConnections(value: unknown): string[] {
  if (!value || typeof value !== "string" || value.trim() === "") {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

/** Parse persisted quota permissions without confusing corruption with allow-all. */
export function parseAllowedQuotas(value: unknown): string[] {
  let parsed: unknown;
  try {
    if (typeof value !== "string") throw new Error();
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Invalid API key quota policy");
  }
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
    throw new Error("Invalid API key quota policy");
  }
  return parsed;
}

export function parseStringList(value: unknown): string[] {
  if (!value || typeof value !== "string" || value.trim() === "") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

export function parseNullableTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function parseIsBanned(value: unknown): boolean {
  return value === 1 || value === "1" || value === true;
}

export function parseStreamDefaultMode(value: unknown): "legacy" | "json" {
  return value === "json" ? "json" : "legacy";
}

export function parseCacheDefaultMode(value: unknown): "legacy" | "bypass" {
  return value === "bypass" ? "bypass" : "legacy";
}

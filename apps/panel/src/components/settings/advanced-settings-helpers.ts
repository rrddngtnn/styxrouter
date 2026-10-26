export const REDACTED = "[REDACTED]";

export interface MigrationResult {
  migrated: number;
  failed: number;
  skipped: number;
  backup: string | null;
  dryRun: boolean;
}

export function parseMigrationResult(value: unknown, dryRun: boolean): MigrationResult {
  const result = value as MigrationResult | null;
  if (!result || typeof result !== "object" || result.dryRun !== dryRun ||
    ![result.migrated, result.failed, result.skipped].every((count) => Number.isSafeInteger(count) && count >= 0) ||
    (dryRun ? result.backup !== null : typeof result.backup !== "string" || !result.backup)) {
    throw new Error("Invalid migration response. The operation may have run; inspect the source database before retrying.");
  }
  return result;
}

type SettingsBag = Record<string, unknown>;

/** Match the server's accepted Host forms; its current parser rejects bracketed IPv6. */
export function isMigrationLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return /(password|passwd|secret|credential|authorization|cookie|privatekey|apikey|accesstoken|refreshtoken|idtoken|authtoken|sessionkey|encryptionkey|signingkey|bearer|sessiontoken|^token$)/.test(normalized);
}

function isSensitiveValue(value: string): boolean {
  if (/^(bearer\s|enc:v\d+:)/i.test(value)) return true;
  try {
    const url = new URL(value);
    return Boolean(url.username || url.password) || [...url.searchParams.keys()].some(isSensitiveKey);
  } catch {
    return false;
  }
}

/** Redact before rendering, searching, copying, or exporting. Never mutate the API payload. */
export function sanitizeSettings(settings: SettingsBag): SettingsBag {
  function sanitize(value: unknown, key = ""): unknown {
    if (isSensitiveKey(key) && value !== null && typeof value !== "boolean") return REDACTED;
    if (typeof value === "string" && isSensitiveValue(value)) return REDACTED;
    if (Array.isArray(value)) return value.map((entry) => sanitize(entry));
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([name, entry]) => [name, sanitize(entry, name)]));
    }
    return value;
  }
  return sanitize(settings) as SettingsBag;
}

/** Match keys/paths only; preserve ancestors and original array indices. Input must already be sanitized. */
export function filterSettings(settings: SettingsBag, search: string): SettingsBag {
  const query = search.trim().toLowerCase();
  if (!query) return settings;
  const missing = Symbol("missing");
  function filter(value: unknown, path: string): unknown {
    if (path.toLowerCase().includes(query)) return value;
    if (!value || typeof value !== "object") return missing;
    if (Array.isArray(value)) {
      const entries = value.map((entry, index) => filter(entry, `${path}.${index}`));
      return entries.every((entry) => entry === missing) ? missing : entries.map((entry) => entry === missing ? null : entry);
    }
    const entries = Object.entries(value)
      .map(([key, entry]) => [key, filter(entry, path ? `${path}.${key}` : key)] as const)
      .filter(([, entry]) => entry !== missing);
    return entries.length ? Object.fromEntries(entries) : missing;
  }
  const result = filter(settings, "");
  return result === missing ? {} : result as SettingsBag;
}

import { chmodSync, copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const EDITABLE_ENV_ALLOWLIST = new Set([
  "PORT",
  "DATA_DIR",
  "STYX_ANTIGRAVITY_CLIENT_PROFILE",
  "STYX_TRUSTED_PUBLIC_ORIGIN",
  "AUTH_COOKIE_SECURE",
  "STYX_BACKUP_KEEP",
  "STYX_BACKUP_MIN_FREE_MB",
  "STYX_BACKUP_INTERVAL_HOURS",
  "STYX_DISABLE_TOKEN_HEALTHCHECK",
  "RATMAN_SOUL_PATH",
  "RATE_LIMIT_MAX_WAIT_MS",
  "RATE_LIMIT_MAX_QUEUE_DEPTH",
  "PROVIDER_COOLDOWN_ENABLED",
  "QUOTA_PREFLIGHT_CUTOFF_ENABLED",
  "STREAM_RECOVERY_ENABLED",
  "STREAM_RECOVERY_MIDSTREAM_ENABLED",
  "STREAM_THROUGHPUT_WATCHDOG_ENABLED",
]);

const SECRET_ENV_KEYS = new Set([
  "STORAGE_ENCRYPTION_KEY",
  "JWT_SECRET",
  "API_KEY_SECRET",
  "INITIAL_PASSWORD",
]);

export interface MaskedEnvEntry {
  key: string;
  value: string;
  masked: boolean;
  editable: boolean;
}

export function defaultServerEnvPath(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env");
}

function hasBalancedQuotes(val: string): boolean {
  if (val.startsWith('"') || val.endsWith('"')) {
    if (!(val.startsWith('"') && val.endsWith('"') && val.length >= 2)) return false;
  }
  if (val.startsWith("'") || val.endsWith("'")) {
    if (!(val.startsWith("'") && val.endsWith("'") && val.length >= 2)) return false;
  }
  return true;
}

export function validateEnvUpdates(
  updates: Record<string, unknown>,
): { ok: true } | { ok: false; error: string } {
  const entries = Object.entries(updates);
  if (entries.length === 0 || entries.length > 30) {
    return { ok: false, error: "Provide between 1 and 30 environment keys" };
  }
  for (const [key, rawValue] of entries) {
    if (!EDITABLE_ENV_ALLOWLIST.has(key)) {
      return { ok: false, error: `Key "${key}" is not in the editable environment allowlist` };
    }
    if (typeof rawValue !== "string" || rawValue.length > 1000) {
      return { ok: false, error: `Invalid value for "${key}"` };
    }
    if (/[\r\n\0]/.test(rawValue)) {
      return { ok: false, error: `Multi-line or control characters are forbidden in "${key}"` };
    }
    if (!hasBalancedQuotes(rawValue.trim())) {
      return { ok: false, error: `Unbalanced quotes in "${key}"` };
    }
  }
  return { ok: true };
}

export function parseMaskedEnvFile(envPath = defaultServerEnvPath()): MaskedEnvEntry[] {
  if (!existsSync(envPath)) return [];
  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  const out: MaskedEnvEntry[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const rawVal = trimmed.slice(eq + 1).trim();
    const isSecret = SECRET_ENV_KEYS.has(key) || /SECRET|PASSWORD|TOKEN|KEY/i.test(key);
    out.push({
      key,
      value: isSecret ? "[MASKED]" : rawVal,
      masked: isSecret,
      editable: EDITABLE_ENV_ALLOWLIST.has(key) && !isSecret,
    });
  }
  return out;
}

export function applyEnvUpdatesToFile(
  envPath: string,
  updates: Record<string, string>,
): { updatedKeys: string[]; backupPath: string | null } {
  const check = validateEnvUpdates(updates);
  if (check.ok === false) {
    throw new Error(check.error);
  }

  let backupPath: string | null = null;
  let existingLines: string[] = [];
  if (existsSync(envPath)) {
    backupPath = `${envPath}.bak`;
    copyFileSync(envPath, backupPath);
    chmodSync(backupPath, 0o600);
    existingLines = readFileSync(envPath, "utf8").split(/\r?\n/);
  }

  const remaining = new Map(Object.entries(updates));
  const nextLines = existingLines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return line;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) return line;
    const key = trimmed.slice(0, eq).trim();
    if (!remaining.has(key)) return line;
    const nextVal = remaining.get(key)!;
    remaining.delete(key);
    return `${key}=${nextVal}`;
  });

  for (const [key, val] of remaining.entries()) {
    nextLines.push(`${key}=${val}`);
  }

  const finalContent = nextLines.join("\n").replace(/\n+$/, "") + "\n";
  writeFileSync(envPath, finalContent, { mode: 0o600 });
  chmodSync(envPath, 0o600);

  return {
    updatedKeys: Object.keys(updates),
    backupPath,
  };
}

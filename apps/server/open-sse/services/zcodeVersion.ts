/**
 * zcodeVersion.ts — live version drift tracker for ZCode CLI identity.
 *
 * Z.ai's backend treats requests matching an official ZCode-CLI version
 * fingerprint as first-party coding-plan traffic. A stale version header
 * (or no version header at all) signals "not an official client" and can
 * trip account-level filters. This module caches the most recent ZCode
 * version seen upstream for 6 hours and parses it off whichever source
 * responds first.
 *
 * Source:
 *   - https://api.github.com/repos/zai-org/ZCode/tags  (official repo
 *     publishes a semver tag per Electron release; parses the first
 *     non-"preview" tag)
 * The fallback constant below only applies when the source fails; it is
 * the last ZCode Desktop release observed when this module was written.
 */

const ZCODE_GITHUB_TAGS_URL = "https://api.github.com/repos/zai-org/ZCode/tags";


export const ZCODE_VERSION_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
export const ZCODE_VERSION_FETCH_TIMEOUT_MS = 5_000;
export const ZCODE_FALLBACK_VERSION = "3.16.3";

type VersionCache = {
  fetchedAt: number;
  version: string;
};

const state: {
  cache: VersionCache | null;
  inFlight: Promise<string | null> | null;
  observed: VersionCache | null;
} = { cache: null, inFlight: null, observed: null };

function normalizeVersion(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/^v/i, "");
  const match = trimmed.match(/^(\d+\.\d+\.\d+)$/);
  return match ? match[1] : null;
}

function compareSemver(a: string, b: string): number {
  const aParts = a.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const bParts = b.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < 3; i += 1) {
    if (aParts[i] !== bParts[i]) return aParts[i] - bParts[i];
  }
  return 0;
}

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ZCODE_VERSION_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "StyxRouter-ZCodeVersion/1.0",
      },
      signal: controller.signal,
      redirect: "error",
    });
    if (!response.ok) throw new Error(`${url} returned ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

function parseGithubTags(payload: unknown): string | null {
  if (!Array.isArray(payload)) return null;
  const versions: string[] = [];
  for (const entry of payload) {
    const name = (entry as { name?: unknown })?.name;
    const normalized = normalizeVersion(name);
    if (normalized) versions.push(normalized);
    if (versions.length >= 10) break; // first page is enough
  }
  if (!versions.length) return null;
  return versions.reduce((best, candidate) =>
    compareSemver(candidate, best) > 0 ? candidate : best,
  );
}

async function resolveLatestZcodeVersion(): Promise<string | null> {
  try {
    const tags = await fetchJson(ZCODE_GITHUB_TAGS_URL);
    const v = parseGithubTags(tags);
    if (v) return v;
  } catch {
    /* preserve the last-good version */
  }
  return null;
}

export async function getZcodeVersion(force = false): Promise<string> {
  const now = Date.now();
  if (!force && state.cache && now - state.cache.fetchedAt < ZCODE_VERSION_CACHE_TTL_MS) {
    return state.cache.version;
  }
  if (!state.inFlight) state.inFlight = resolveLatestZcodeVersion()
    .then((version) => {
      if (!version) return null;
      state.observed = { fetchedAt: Date.now(), version };
      const latest = state.cache && compareSemver(state.cache.version, version) > 0 ? state.cache.version : version;
      state.cache = { fetchedAt: Date.now(), version: latest };
      return latest;
    })
    .finally(() => {
      state.inFlight = null;
    });
  const version = await state.inFlight;
  if (!version && force) throw new Error("Version sources unavailable");
  return version ?? state.cache?.version ?? ZCODE_FALLBACK_VERSION;
}

/** Synchronous getter that returns the cached version or the fallback. */
export function getCachedZcodeVersion(): string {
  return state.cache?.version ?? ZCODE_FALLBACK_VERSION;
}

export function getZcodeVersionObservation(): { observedVersion: string | null; observedAt: number | null } {
  return { observedVersion: state.observed?.version ?? null, observedAt: state.observed?.fetchedAt ?? null };
}

/** Reset state — tests only. */
export function __resetZcodeVersionCacheForTesting(): void {
  state.cache = null;
  state.inFlight = null;
  state.observed = null;
}

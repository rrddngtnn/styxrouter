const ANTIGRAVITY_IDE_RELEASE_FEED_URL =
  "https://antigravity-auto-updater-974169037036.us-central1.run.app/releases";
// Match the darwin/arm64 identity emitted by antigravityHeaders.ts, not the host platform.
const ANTIGRAVITY_CLI_RELEASE_URL =
  "https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/darwin_arm64.json";

export const ANTIGRAVITY_VERSION_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
export const ANTIGRAVITY_VERSION_FETCH_TIMEOUT_MS = 5_000;
export const ANTIGRAVITY_IDE_FALLBACK_VERSION = "2.1.1";
export const ANTIGRAVITY_CLI_FALLBACK_VERSION = "1.1.5";

type VersionCache = {
  fetchedAt: number;
  version: string;
};

type ProductVersionState = {
  cache: VersionCache | null;
  observed: VersionCache | null;
  inFlight: Promise<string | null> | null;
};

type FetchLike = typeof fetch;
type VersionParser = (payload: unknown) => string | null;

const ideState: ProductVersionState = { cache: null, observed: null, inFlight: null };
const cliState: ProductVersionState = { cache: null, observed: null, inFlight: null };

function normalizeVersion(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/^v/i, "");
  const match = trimmed.match(/^(\d+\.\d+\.\d+)\b/);
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

function pickNewestVersion(...versions: unknown[]): string | null {
  return versions
    .map((version) => normalizeVersion(version))
    .filter((version): version is string => !!version)
    .reduce<string | null>(
      (best, version) => (!best || compareSemver(version, best) > 0 ? version : best),
      null
    );
}

async function fetchJsonWithTimeout(fetchImpl: FetchLike, url: string): Promise<unknown> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ANTIGRAVITY_VERSION_FETCH_TIMEOUT_MS);

  try {
    const response = await fetchImpl(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "StyxRouter-AntigravityVersion/1.0",
      },
      signal: controller.signal,
      redirect: "error",
    });

    if (!response.ok) {
      throw new Error(`Version source ${url} returned ${response.status}`);
    }

    if (url !== ANTIGRAVITY_CLI_RELEASE_URL) return await response.json();
    const maxBytes = 16 * 1024;
    const length = response.headers.get("content-length");
    if (length && Number(length) > maxBytes) throw new Error("Manifest too large");
    if (!response.body) throw new Error("Empty manifest");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) throw new Error("Manifest too large");
        chunks.push(value);
      }
    } finally {
      reader.cancel().catch(() => {});
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(bytes));
  } finally {
    clearTimeout(timeoutId);
  }
}

function parseIdeReleaseFeed(payload: unknown): string | null {
  if (!Array.isArray(payload)) return null;
  return pickNewestVersion(...payload.map((entry) => (entry as { version?: unknown })?.version));
}

function parseCliRelease(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const { version } = payload as { version?: unknown };
  return typeof version === "string" && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)
    ? version : null;
}

async function resolveProductVersion(
  state: ProductVersionState,
  fallbackVersion: string,
  sourceUrl: string,
  parsePayload: VersionParser,
  fetchImpl: FetchLike,
  force = false
): Promise<string> {
  const now = Date.now();
  if (!force && state.cache && now - state.cache.fetchedAt < ANTIGRAVITY_VERSION_CACHE_TTL_MS) {
    return pickNewestVersion(state.cache.version, fallbackVersion) ?? fallbackVersion;
  }

  if (!state.inFlight) state.inFlight = (async () => {
    let resolved: string | null = null;
    try {
      resolved = parsePayload(await fetchJsonWithTimeout(fetchImpl, sourceUrl));
    } catch {
      resolved = null;
    }

    const version =
      pickNewestVersion(resolved, state.cache?.version, fallbackVersion) ?? fallbackVersion;

    if (resolved) {
      state.observed = { fetchedAt: Date.now(), version: resolved };
      state.cache = {
        fetchedAt: Date.now(),
        version,
      };
    }
    return resolved ? version : null;
  })();

  const flight = state.inFlight;
  try {
    const version = await flight;
    if (!version && force) throw new Error("Version source unavailable");
    return version ?? pickNewestVersion(state.cache?.version, fallbackVersion) ?? fallbackVersion;
  } finally {
    if (state.inFlight === flight) state.inFlight = null;
  }
}

function seedVersionCache(state: ProductVersionState, version: string, fetchedAt: number): void {
  const normalized = normalizeVersion(version);
  if (!normalized) {
    throw new TypeError(`Invalid Antigravity version: ${version}`);
  }
  state.cache = { fetchedAt, version: normalized };
}

export function resolveAntigravityIdeVersion(fetchImpl: FetchLike = fetch, force = false): Promise<string> {
  return resolveProductVersion(
    ideState,
    ANTIGRAVITY_IDE_FALLBACK_VERSION,
    ANTIGRAVITY_IDE_RELEASE_FEED_URL,
    parseIdeReleaseFeed,
    fetchImpl,
    force
  );
}

export function resolveAntigravityCliVersion(fetchImpl: FetchLike = fetch, force = false): Promise<string> {
  return resolveProductVersion(
    cliState,
    ANTIGRAVITY_CLI_FALLBACK_VERSION,
    ANTIGRAVITY_CLI_RELEASE_URL,
    parseCliRelease,
    fetchImpl,
    force
  );
}

export function getCachedAntigravityIdeVersion(): string {
  return ideState.cache?.version ?? ANTIGRAVITY_IDE_FALLBACK_VERSION;
}

export function getCachedAntigravityCliVersion(): string {
  return cliState.cache?.version ?? ANTIGRAVITY_CLI_FALLBACK_VERSION;
}

/** Last successful upstream observation in this process, independent of retained cache. */
export function getAntigravityVersionObservation(product: "ide" | "cli"): { observedVersion: string | null; observedAt: number | null } {
  const observed = (product === "ide" ? ideState : cliState).observed;
  return { observedVersion: observed?.version ?? null, observedAt: observed?.fetchedAt ?? null };
}

export function seedAntigravityIdeVersionCache(version: string, fetchedAt = Date.now()): void {
  seedVersionCache(ideState, version, fetchedAt);
}

export function seedAntigravityCliVersionCache(version: string, fetchedAt = Date.now()): void {
  seedVersionCache(cliState, version, fetchedAt);
}

export function clearAntigravityVersionCaches(): void {
  ideState.cache = null;
  ideState.observed = null;
  ideState.inFlight = null;
  cliState.cache = null;
  cliState.observed = null;
  cliState.inFlight = null;
}

/**
 * Idempotency Layer — Phase 9.2
 *
 * In-memory deduplication of requests with the same idempotency key.
 * If a request with the same key arrives within 5 seconds, returns
 * the cached response instead of making a new API call.
 *
 * Headers: X-Request-Id or Idempotency-Key
 *
 * @module lib/idempotencyLayer
 */

import { getSettings } from "@/lib/localDb";

const DEFAULT_WINDOW_MS = 5000;

/** @type {Map<string, { response: object, status: number, expiresAt: number }>} */
const idempotencyStore = new Map<string, { body: string; status: number; expiresAt: number; bytes: number }>();
const MAX_ENTRIES = 256;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_ENTRY_BYTES = 1024 * 1024;
let retainedBytes = 0;

function removeEntry(key: string) {
  const entry = idempotencyStore.get(key);
  if (!entry) return;
  retainedBytes -= entry.bytes;
  idempotencyStore.delete(key);
}

function removeExpired(now: number) {
  for (const [key, entry] of idempotencyStore) {
    if (now >= entry.expiresAt) removeEntry(key);
  }
}

// Periodic cleanup every 30s
let cleanupInterval;

function ensureCleanup() {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => {
    const now = Date.now();
    removeExpired(now);
  }, 30000);
  // Don't prevent process exit
  if (cleanupInterval.unref) cleanupInterval.unref();
}

/**
 * Extract idempotency key from request headers.
 * @param {Headers|object} headers
 * @returns {string|null}
 */
export function getIdempotencyKey(headers) {
  if (!headers) return null;
  const get = typeof headers.get === "function" ? (k) => headers.get(k) : (k) => headers[k];
  return get("idempotency-key") || get("x-request-id") || null;
}

/**
 * Check if a response exists for the given idempotency key.
 * @param {string} key
 * @returns {{ response: object, status: number }|null}
 */
export function checkIdempotency(key) {
  if (!key) return null;
  const entry = idempotencyStore.get(key);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    removeEntry(key);
    return null;
  }
  return { response: JSON.parse(entry.body), status: entry.status };
}

/**
 * Save a response for idempotency dedup.
 * @param {string} key
 * @param {object} response - Response body to cache
 * @param {number} status - HTTP status code
 * @param {number} [windowMs=5000] - Dedup window in ms
 */
export function saveIdempotency(key, response, status, windowMs = DEFAULT_WINDOW_MS) {
  if (!key) return;
  removeEntry(key);
  const now = Date.now();
  removeExpired(now);
  let body: string;
  try {
    body = JSON.stringify(response);
  } catch {
    return;
  }
  if (typeof body !== "string" || !Number.isFinite(windowMs) || windowMs <= 0) return;
  const bytes = Buffer.byteLength(body) + Buffer.byteLength(key);
  if (bytes > MAX_ENTRY_BYTES) return;
  while (idempotencyStore.size >= MAX_ENTRIES || retainedBytes + bytes > MAX_BYTES) {
    const oldest = idempotencyStore.keys().next();
    if (oldest.done) break;
    removeEntry(oldest.value);
  }
  ensureCleanup();
  idempotencyStore.set(key, { body, status, expiresAt: now + windowMs, bytes });
  retainedBytes += bytes;
}

/**
 * Get current idempotency store stats.
 */
export async function getIdempotencyStats() {
  let windowMs = DEFAULT_WINDOW_MS;
  try {
    const settings = await getSettings();
    if (typeof settings.idempotencyWindowMs === "number" && settings.idempotencyWindowMs > 0) {
      windowMs = settings.idempotencyWindowMs;
    }
  } catch {
    // Fallback to default if settings unavailable
  }
  return {
    activeKeys: idempotencyStore.size,
    retainedBytes,
    maxEntries: MAX_ENTRIES,
    maxBytes: MAX_BYTES,
    windowMs,
  };
}

/**
 * Clear all idempotency entries (for testing).
 */
export function clearIdempotency() {
  idempotencyStore.clear();
  retainedBytes = 0;
}

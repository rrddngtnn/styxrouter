import { isIP } from "node:net";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";
import { createGunzip, createInflate, createBrotliDecompress } from "node:zlib";
import {
  type OutboundUrlGuardMode,
  isCloudMetadataHost,
  isPrivateHost,
  parseAndValidatePublicUrl,
  parseAndValidateNonMetadataUrl,
  parseOutboundUrl,
} from "@/shared/network/outboundUrlGuard";
import { getProviderOutboundGuard } from "@/shared/network/outboundUrlGuardPolicy";
import { resolveProxyForRequest } from "../../../open-sse/utils/proxyFetch";

function requireDirectPinnedTransport(url: URL) {
  if (resolveProxyForRequest(url.toString()).source !== "direct") {
    throw new Error("Guarded remote media fetch cannot enforce DNS pinning through a configured proxy");
  }
}

const DEFAULT_MAX_REMOTE_IMAGE_BYTES = 20 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MS = 15000;

/**
 * Minimal DNS lookup contract — matches the shape returned by
 * `node:dns/promises`.lookup(host, { all: true }). Exposed as an option so
 * tests can inject a fake resolver without touching real DNS.
 */
export type RemoteImageLookup = (
  hostname: string
) => Promise<Array<{ address: string; family: number }>>;

export interface RemoteImageFetchOptions {
  /** Require HTTPS for the initial URL and every redirect hop. Default false for compatibility. */
  enforceHttps?: boolean;
  /** Trusted custom transport; responsible for enforcing its own connection policy. */
  fetchImpl?: typeof fetch;
  /** Legacy option: guarded production transports always pin DNS. */
  pinDns?: boolean;
  guard?: OutboundUrlGuardMode;
  /** Non-sensitive request headers, applied to every validated redirect hop. */
  headers?: RequestInit["headers"];
  maxBytes?: number;
  maxRedirects?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  /**
   * DNS resolver used for the rebinding guard. Defaults to
   * `dns.promises.lookup(host, { all: true })`. Tests can pass a fake.
   */
  lookup?: RemoteImageLookup;
}

export interface RemoteImageFetchResult {
  buffer: Buffer<ArrayBuffer>;
  contentType: string;
  url: string;
}

/** Generic aliases for non-image callers that need the same SSRF/bounds policy. */
export type RemoteMediaFetchOptions = RemoteImageFetchOptions;
export type RemoteMediaFetchResult = RemoteImageFetchResult;

function validateRemoteImageUrl(input: string | URL, guard: OutboundUrlGuardMode) {
  return guard === "public-only" ? parseAndValidatePublicUrl(input)
    : guard === "block-metadata" ? parseAndValidateNonMetadataUrl(input)
    : parseOutboundUrl(input);
}

function requireHttps(url: URL, enabled: boolean): URL {
  if (enabled && url.protocol !== "https:") {
    throw new Error("Remote media requires HTTPS at every redirect hop");
  }
  return url;
}

const defaultLookup: RemoteImageLookup = (hostname) => dns.promises.lookup(hostname, { all: true });

/** Resolve and validate all answers before binding the transport to one of them. */
export async function resolveAllowedAddresses(
  url: URL,
  guard: OutboundUrlGuardMode,
  lookup: RemoteImageLookup,
  signal: AbortSignal
): Promise<Array<{ address: string; family: number }>> {
  if (guard === "none") return [];
  const hostname = url.hostname;
  const bare =
    hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  if (!bare) return [];
  if (isIP(bare)) return [{ address: bare, family: isIP(bare) }];
  let resolved: Array<{ address: string; family: number }>;
  try {
    signal.throwIfAborted();
    resolved = await new Promise((resolve, reject) => {
      const abort = () => { signal.removeEventListener("abort", abort); reject(signal.reason); };
      signal.addEventListener("abort", abort, { once: true });
      Promise.resolve().then(() => lookup(bare)).then(resolve, reject)
        .finally(() => signal.removeEventListener("abort", abort));
      if (signal.aborted) abort();
    });
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    throw new Error("Remote image host could not be resolved (blocked)");
  }
  if (!resolved.length) {
    throw new Error("Remote image host could not be resolved (blocked)");
  }
  for (const { address, family } of resolved) {
    const version = isIP(address);
    if (!version || version !== family) {
      throw new Error("Remote image host resolved to an invalid address (blocked)");
    }
    // URL canonicalization makes equivalent expanded IPv6 spellings comparable.
    const canonical = version === 6 ? new URL(`http://[${address}]/`).hostname : address;
    if (guard === "public-only" ? isPrivateHost(canonical) : isCloudMetadataHost(canonical)) {
      throw new Error("Remote image host resolves to a blocked address (DNS rebinding)");
    }
  }
  return resolved;
}
/**
 * Build a `fetch` bound to a single already-DNS-validated address, ignoring
 * whatever the hostname resolves to at connect time. Exported for direct
 * testing: this is the mechanism that closes the DNS-rebinding TOCTOU gap
 * (GHSA-cmhj-wh2f-9cgx) — a second, real DNS lookup at connect time could
 * otherwise return a different (possibly private) address than the one
 * `resolveAllowedAddresses` validated. The original URL remains intact for
 * Host and TLS certificate/SNI validation.
 */
export function createPinnedFetch(address: string, family: number): typeof fetch {
  return ((input, init) => new Promise<Response>((resolve, reject) => {
    const url = new URL(String(input));
    requireDirectPinnedTransport(url);
    const request = (url.protocol === "https:" ? https : http).request(url, {
      method: init?.method ?? "GET",
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      signal: init?.signal ?? undefined,
      // Node's `net.connect`/`tls.connect` invoke a custom `lookup` in one of
      // two incompatible shapes depending on `options.all`: modern Node
      // (autoSelectFamily / Happy Eyeballs, on by default since Node 18)
      // calls `lookup(hostname, { all: true, ... }, callback)` and requires
      // `callback(err, addresses[])` — an array of `{ address, family }`.
      // Only when `all` is falsy does it accept the single-address form
      // `callback(err, address, family)`.
      lookup: (_hostname, options, callback) => {
        if (options && typeof options === "object" && "all" in options && options.all) {
          callback(null, [{ address, family }]);
          return;
        }
        callback(null, address, family);
      },
      agent: false,
    }, (response) => {
      let decoder: ReturnType<typeof createGunzip> | null = null;
      try {
        const headers = new Headers();
        for (let i = 0; i < response.rawHeaders.length; i += 2) {
          headers.append(response.rawHeaders[i], response.rawHeaders[i + 1]);
        }
        const status = response.statusCode ?? 500;
        if ([204, 205, 304].includes(status)) {
          const result = new Response(null, { status, headers });
          response.resume();
          resolve(result);
        } else {
          const encoding = headers.get("content-encoding")?.toLowerCase().trim();
          decoder = encoding === "gzip" || encoding === "x-gzip" ? createGunzip()
            : encoding === "deflate" ? createInflate()
            : encoding === "br" ? createBrotliDecompress() : null;
          if (decoder) {
            const stream = decoder;
            response.on("error", (error) => stream.destroy(error));
            stream.on("close", () => response.destroy());
            response.pipe(stream);
          }
          resolve(new Response(Readable.toWeb(decoder ?? response) as ReadableStream, { status, headers }));
        }
      } catch (error) {
        decoder?.destroy();
        response.destroy();
        reject(error);
      }
    });
    request.on("error", reject);
    if (init?.body != null && typeof init.body !== "string") {
      request.destroy(new Error("Pinned transport supports only string request bodies"));
      return;
    }
    request.end(init?.body ?? undefined);
  })) as typeof fetch;
}
function combineSignals(signal: AbortSignal | undefined, timeoutMs: number) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeoutSignal;
  return AbortSignal.any([signal, timeoutSignal]);
}

async function readResponseBuffer(response: Response, maxBytes: number) {
  const contentLengthHeader = response.headers.get("content-length");
  const contentLength = contentLengthHeader ? Number.parseInt(contentLengthHeader, 10) : null;
  if (contentLength !== null && Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel();
    throw new Error(`Remote image exceeds ${maxBytes} byte limit`);
  }

  if (!response.body) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) {
      throw new Error(`Remote image exceeds ${maxBytes} byte limit`);
    }
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = Buffer.from(value);
      totalBytes += chunk.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new Error(`Remote image exceeds ${maxBytes} byte limit`);
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks, totalBytes);
}

export async function fetchRemoteMedia(
  input: string | URL,
  options: RemoteMediaFetchOptions = {}
): Promise<RemoteMediaFetchResult> {
  const injectedFetch = options.fetchImpl;

  const guard = options.guard ?? getProviderOutboundGuard();
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_REMOTE_IMAGE_BYTES;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const signal = combineSignals(options.signal, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const lookup = options.lookup ?? defaultLookup;

  let currentUrl = requireHttps(
    validateRemoteImageUrl(input, guard),
    options.enforceHttps === true
  );
  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount++) {
    // Validate and pin each hop; injected transports are trusted to enforce their own policy.
    if (guard !== "none" && !injectedFetch) requireDirectPinnedTransport(currentUrl);
    const addresses = await resolveAllowedAddresses(currentUrl, guard, lookup, signal);
    const init = { method: "GET", redirect: "manual" as const, signal, headers: options.headers };
    let response: Response;
    if (injectedFetch || !addresses.length) {
      response = await (injectedFetch ?? fetch)(currentUrl.toString(), init);
    } else {
      let lastError: unknown;
      let result: Response | undefined;
      for (const { address, family } of addresses) {
        signal.throwIfAborted();
        try {
          result = await createPinnedFetch(address, family)(currentUrl.toString(), init);
          break;
        } catch (error) {
          if (signal.aborted) throw signal.reason;
          lastError = error;
        }
      }
      if (!result) throw lastError;
      response = result;
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) {
        throw new Error(`Remote image redirect missing Location header (${response.status})`);
      }
      if (redirectCount >= maxRedirects) {
        throw new Error(`Remote image exceeded ${maxRedirects} redirect limit`);
      }
      currentUrl = requireHttps(
        validateRemoteImageUrl(new URL(location, currentUrl), guard),
        options.enforceHttps === true
      );
      continue;
    }

    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Remote image fetch error ${response.status}`);
    }

    return {
      buffer: await readResponseBuffer(response, maxBytes),
      contentType: response.headers.get("content-type") || "application/octet-stream",
      url: currentUrl.toString(),
    };
  }

  throw new Error(`Remote image exceeded ${maxRedirects} redirect limit`);
}

/** Backward-compatible image-specific entry point. */
export async function fetchRemoteImage(
  input: string | URL,
  options: RemoteImageFetchOptions = {}
): Promise<RemoteImageFetchResult> {
  return fetchRemoteMedia(input, options);
}

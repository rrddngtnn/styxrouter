# Log URL opaque-path redaction: design under test

## Problem and scope

`redactLogUrl` currently protects URL userinfo and sensitive query/fragment parameters, but preserves every path segment. A credential, tenant identifier, signed object name, or arbitrary client-provided value in a path therefore survives. This is not reliably distinguishable from a harmless identifier by length, character set, entropy, or percent encoding. The goal is safe **log copies**, not rewriting requests or changing route dispatch. This is a proposed design; no fix is implemented yet.

## Proposed contract

- Treat paths as untrusted. Preserve only explicitly reviewed, exact static route prefixes or complete route templates, not a per-segment vocabulary: an attacker can put a secret equal to a common route word in a dynamic position. After the last verified static prefix, replace every untrusted segment with a stable `[REDACTED]` marker; unknown routes fail closed. Static suffixes may be preserved only when a route template proves their position. Preserve separators as appropriate for diagnostic shape, never values or lengths.
- Match routes case-sensitively according to actual routing semantics. Validate encoded and malformed input conservatively; encoded separators, repeated encoding, traversal/dot segments, ambiguous delimiters and failed decoding must not change which bytes are classified as static. Never echo a decoded or raw dynamic value. Avoid normalizing away evidence before redaction. For malformed or ambiguous URLs, redact the entire uncertain path rather than guessing.
- Preserve diagnostic scheme/host where safe, recognized static route text such as `/v1/chat/completions`, and existing benign query parameters such as `model=visible`, while retaining current query, userinfo and fragment redaction. URL parsing must cover absolute URLs, relative endpoints, and URLs embedded in error text; boundaries and punctuation require explicit tests. Nested URLs and encoded values must not bypass path protection.
- Route catalogs should derive from reviewed public/provider route templates, not user-provided configuration. Unknown provider custom paths lose detail by default; consider explicit trusted templates only if provisioned through a controlled contract. Dynamic model IDs, resource names and deployment names are unsafe even when useful for diagnosis. Record a separately sourced non-secret provider/model field if needed instead of exposing path segments.
- Apply consistently at every log boundary and on historical read, without modifying historical rows. Preserve current handling for query credentials, headers and non-URL payload content. Never claim all logging is covered merely because the central helper is fixed: audit independent logger/error paths separately.

## Observed surfaces

- `open-sse/utils/requestLogger.ts`: `logClientRawRequest` and `logTargetRequest` call the helper at capture; `chatCore.ts`, `handlers/embeddings.ts` and `providerRequestLogging.ts` supply request paths/URLs.
- `src/lib/logPayloads.ts`: `redactPayload` calls the helper for `url`, `endpoint`, `path` fields and strings containing HTTP(S), including nested error text; `protectPayloadForLog` invokes it.
- `src/lib/usage/callLogs.ts`: helper used both when storing call-log paths and projecting rows. Existing detailed-log protection also uses the payload path; changing helper must preserve historical read behavior without writing rows.
- Other direct loggers, raw errors, WebSocket URLs and non-HTTP schemes are outside the narrow tests and need a separate inventory before making an end-to-end secrecy claim.

## Verification

`apps/server/tests/log-url-opaque-path-sdd.test.ts` contains intentionally failing synthetic tests for helper output, request capture and protected payloads, plus short/encoded values. Run only via `cd apps/server && bun scripts/test-isolated.ts tests/log-url-opaque-path-sdd.test.ts`. The runner sets scratch HOME, data and temp before imports; request logger imports currently initialize an isolated scratch database even though these tests do not access DB APIs. Expand with independent assertions per encoded case, unknown routes, known complete paths, static suffix templates, nested URLs, malformed encodings, query/fragment regressions and historical read once implementation is proposed.

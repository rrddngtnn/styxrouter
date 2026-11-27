# v0.3.0

## Maintenance UI lineage

This feature release continues the v0.1.6 maintenance source and approved panel,
not the v0.2.0 UI redesign. Existing brand artwork and third-party notices remain.

## Changes

- Adds the separate native `augment-api` provider with tenant-bound encrypted
  credentials, account-scoped discovery and native NDJSON translation.
- Rejects unsupported explicit output budgets, sampling, structured output and
  advanced routing rather than silently dropping intent. Required-budget
  Anthropic Messages is unsupported. Effective proxy and relay transports reject.
- Serves the three retained `/panel/brand/` legal notices as exact UTF-8 text for
  GET/HEAD instead of SPA HTML, with a fixed-name allowlist.

## Limits and remaining work

Augment LIVE acceptance is UNVERIFIED: no account entitlement, live model output,
usage accuracy, discovery cost or free-access claim is made. No static model
capacity is invented. Native support is bounded to text/function tools and
omitted-budget Chat Completions/Responses; dynamic plugin/virtual routing and all
retry/race permutations are not certified. See [adapter limitations](augment-api.md).

The existing Auggie CLI provider still requires its separate installed executable
and legitimate authentication. Magnific is not implemented. Raw Hydrogen
behavior outside the documented router budget contract remains unknown.

CI, protected offline hygiene and exact-image smoke are publication gates; local
synthetic success is not live-provider validation. Private operational prompts
are excluded from public source and images. npm publication remains disabled.

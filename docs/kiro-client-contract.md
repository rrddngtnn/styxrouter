# Kiro generation client contract

The generation executor uses the released **Kiro IDE 0.11.133** CodeWhisperer
streaming contract. This is a compatibility baseline, **not the latest IDE**.
The November 9, 2026 support floor is IDE 0.11.133 / CLI 1.28.2:
https://github.com/kirodotdev/Kiro/issues/11335 . The official downloads page
also announces another retirement on January 15, 2027; recheck support before
that date. Do not derive a user agent from a release number alone.

## Inspected official artifact

- Download page: https://kiro.dev/downloads/
- Artifact: https://prod.download.desktop.kiro.dev/releases/stable/linux-x64/signed/0.11.133/tar/kiro-ide-0.11.133-stable-linux-x64.tar.gz
- Archive SHA-256: `0fc635c376266e02af369377b0bbfe1992dc4fb1c041a1a308bf5849dac76db0`
- Member: `Kiro/resources/app/extensions/kiro.kiro-agent/dist/extension.js`
- Member SHA-256: `62e6e744c7b37eb39dc6e996ec8608d9c1a9982c9b2203e4aaf72d1c4f5c9bd5`

The bundled `src/utils/clients/get-codewhisperer-streaming-client.ts` builds
`CodeWhispererStreaming` with a bearer token and
`customUserAgent: KiroIDE ${kiroVersion} ${machineId}`.
Its bundled `@aws/codewhisperer-streaming-client/package.json` is **1.0.34**;
`runtimeConfig.shared.js` identifies service `CodeWhispererStreaming`.
The bundled Smithy middleware converts the complete custom string to one tuple
and escapes spaces to hyphens. Offline execution of that actual middleware
confirmed the custom suffix is `KiroIDE-0.11.133-<machineId>`, **not**
`kiro-ide/1.0.0`, `KiroIDE/0.11.133`, or an unescaped string.
The SDK prefix is `aws-sdk-js/1.0.34`. `User-Agent` additionally contains
`ua/2.1`, actual OS/release, actual Node compatibility version,
`api/codewhispererstreaming#1.0.34`, and standard-retry feature `m/E`.
The client gets a stable SHA-256 of the normalized OS machine ID; no random
per-request device persona is generated. The official failure sentinel is
`UNDETERMINED_MACHINE_ID`.

The request serializer uses POST `/generateAssistantResponse`, JSON content,
`conversationState` and `profileArn`; token authentication, regional endpoint,
request cancellation and existing proxy/header plumbing remain unchanged.
The existing translator's additional supported fields are not removed.

## Current-release comparison and limits

The official Linux metadata endpoint
https://prod.download.desktop.kiro.dev/stable/metadata-linux-x64-stable.json
reported **1.4.121**, dated November 6, 2026, despite older rendered download-page
labels. Its downloaded artifact was:
https://prod.download.desktop.kiro.dev/releases/stable/linux-x64/signed/1.4.121/tar/kiro-ide-1.4.121-stable-linux-x64.tar.gz

- Archive SHA-256: `818b815e34f126360fe379aa383c0d6f382ca1e46f8afeadb38c4c3129065b42`
- Same extension member SHA-256: `a000f3abeeab4ef86daa3ccbff26df1c40dd41b70d3aa459876ac0e695cd46cd`

That bundle uses a newer KiroRuntime client and experiment-controlled user-agent
policy, including KAS and ACP attribution. Copying its version into the legacy
CodeWhisperer identity would combine different contracts. This patch deliberately
uses the independently inspected, still-supported legacy release instead.
It does not claim full latest-client emulation, upgrade OAuth/quota transports,
or establish that a particular account is currently entitled to generation.

## Error handling

Only an exact Kiro HTTP 403 client-retirement notice is normalized in the
executor to `502 upstream_client_unsupported`, before OAuth refresh. Routing
returns it before retry, fallback, cooldown or account-ban persistence.
Ordinary 401/403 responses are unchanged. Regression tests exercise streaming
and nonstreaming HTTP routing with one/two synthetic accounts, unchanged account
health/tokens, and genuine 401 reaching refresh. The panel distinguishes the
notice from credential failure and generic 403 denial.

## Verification and activation

Run from the repository root:

```
bun run server:test tests/kiro-client-identity.test.ts tests/kiro-client-unsupported-routing.test.ts
bun run panel:test tests/kiro-client-error-decoder.test.ts
bun run server:typecheck
```

These are isolated synthetic dispatch tests, not live acceptance. Official bundle
inspection and offline SDK middleware execution also do not establish service
acceptance. Deployment, exact-account recovery and fresh upstream generation
must be verified separately; never reactivate an account merely because this
suite passes.

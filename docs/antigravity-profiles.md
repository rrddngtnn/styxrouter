# Antigravity execution profiles

Hub is the default execution profile. CLI remains an explicit opt-in. IDE is no
longer a selectable execution profile. Existing saved `clientProfile: "ide"`
and `STYX_ANTIGRAVITY_CLIENT_PROFILE=ide` transparently resolve to Hub without a
database migration or account rewrite. This is an intentional compatibility
change, not an automatic retry after an upstream failure.

Set `providerSpecificData.clientProfile` to `hub` or `cli` on a connection, or
set `STYX_ANTIGRAVITY_CLIENT_PROFILE=cli` to override connection profiles for the
process. A recognized environment override takes precedence. Invalid overrides
are ignored; invalid or absent saved values use Hub. Historical saved `harness`
and `sdk` aliases retain their CLI meaning, but are not offered as new choices.
Legacy IDE is accepted by update validation so an old account can still be
edited; it never enables IDE dispatch.

The same selected identity is used for bootstrap, catalog discovery, quota and
inference. Each inference resolves its profile before asynchronous work and
retains it through its internal attempts. Hub uses the official App `2.31.2`
identity `antigravity/hub/2.31.2 (aidev_client; os_type=darwin; arch=arm64)` and
omits the consumer-project header and the ordinary agent `requestType`; CLI
retains its project header, request type and independent version pin. The CLI
baseline is `1.5.7`, not the Hub release number.

The Hub identity follows the official App launcher's `--subclient_type hub`,
`--override_ide_version` and `--override_user_agent_name antigravity` arguments
and its bundled `codeassistclient.userAgent` formatter, including the
parenthesized `aidev_client`, OS and architecture fields. The official
[Hub releases feed](https://antigravity-hub-auto-updater-974169037036.us-central1.run.app/releases)
and [CLI darwin/arm64 manifest](https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/darwin_arm64.json)
are separate sources. The CLI manifest was checked on 2026-11-13; its archive
SHA-512 is
`c9746409083a9b15c217757aa2ef399ee7d4398602a30038583ea45196fc27d1662745341e45a116c07be19c08587de1e5929e365d2a46aea385fa33f0c2396a`.
Older CLI observations must not downgrade the current baseline or last-good
cache. These identity fixtures establish the request contract, not live
upstream acceptance.
Canonical upstream model IDs are unchanged. No profile retry or new model
fallback is introduced by this change.

## Version diagnostics

The IDE updater feed and IDE version pin API remain for standalone official IDE
diagnostics and backwards-compatible tooling. They do **not** control router
execution: neither an IDE pin nor an IDE release refresh changes Hub headers.
CLI pins still control explicit CLI requests. `/api/versions/antigravity/ide/status`
reports `executionSupported: false`; the CLI status reports `true`.

A catalog response does not establish successful inference or account
entitlement. This source change does not mutate existing installations, restart
services, refresh credentials, or synchronize their stored catalogs.

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
retains it through its internal attempts. Hub uses the existing observed
`2.24.0` identity and omits the consumer-project header and the ordinary agent
`requestType`; CLI retains its project header, request type and version pin.
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

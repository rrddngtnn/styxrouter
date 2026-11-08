# Troubleshooting and support

[Documentation](README.md) · [Configuration](configuration.md)

## Server does not start

For Docker, inspect `docker logs styxrouter`; for Compose, use
`docker compose logs styx`. Source startup runs in the foreground with
`bun run server:start`. Check that the data directory is writable, disk space is
available, and port `20128` is free. A permission error can redirect storage to
the user's default directory; inspect startup warnings.

Use Bun 1.4.3 and `bun install --frozen-lockfile` for source installs. File-backed
sql.js is deliberately unsupported; use a native synchronous SQLite driver.
The native listener binds `0.0.0.0`; a `HOST=127.0.0.1` setting does not restrict it.

## Health works but the panel does not

Open `/panel/` with the trailing slash. Source installs need
`bun run panel:build`; a running server does not build the panel. Health only
checks the HTTP host, not provider credentials or successful inference.

## Login fails

A missing `JWT_SECRET` prevents session creation. The initial password only
bootstraps a database without a saved password; changing it later does not reset
the saved hash. Use the panel's password settings when already authenticated.
For local HTTP, do not force Secure cookies. For HTTPS, check the proxy's
forwarding configuration and Secure-cookie settings. Repeated login failures
are rate limited; honor `Retry-After`.

There is no documented offline password-reset or database-restore procedure.
Do not delete the database to work around login problems.

## Model test returns 403 or 429

The panel's **Test model** requires a session and an exact matching Origin.
Behind TLS termination, set `STYX_TRUSTED_PUBLIC_ORIGIN` to the canonical public
HTTPS origin without a trailing slash, then recreate or restart the server.
Forwarded headers alone are insufficient. Do not mix a configured public origin
with direct HTTP panel access. A `429` can mean a probe is already active or the
five-second interval has not elapsed. See [origin checks](reverse-proxy-origin-security.md).

## Client returns 401 or a model is unavailable

Use a router API key, not the panel password or a provider token. Send it as
`Authorization: Bearer <key>`. Check whether it is active and whether its model,
connection, or quota restrictions permit the request.

Read `/v1/models` with that key and copy the exact model ID. A catalog entry is
not proof of live availability: inspect account activation, catalog sync, upstream
entitlement, and credential status. Nonempty stale account catalogs remain
restrictive until refreshed. Expiry timestamps do not guarantee token refresh.
Use **Test model** for a session-based probe or **Connect tools** for a key-based
client test; both can consume provider usage.

## Streaming stalls

Verify the same request against the local router before debugging the proxy.
Check response buffering and timeouts at every proxy hop. Caddy's
`flush_interval -1` and Nginx's `proxy_buffering off` are relevant streaming
settings. Cloudflare Quick Tunnels do not support SSE. Some IDE relays cannot
reach loopback or private tailnet addresses. See [client networking](harness-connections.md#network-exposure).

## Backup or credential problems

Backups need snapshot space plus headroom; free disk space without deleting
SQLite sidecars. Preserve `STORAGE_ENCRYPTION_KEY`: a changed or missing key can
make encrypted credentials unreadable. Do not assume a backup provides a safe
restore path; [restore remains unsupported](sqlite-restore-blocker.md).

## Get help

[Open an issue](https://github.com/rrddngtnn/styxrouter/issues) for non-sensitive
bugs or usage questions. Include the image tag or commit, OS/architecture,
installation method, affected endpoint, status code, and a minimal redacted
reproduction. State whether the problem occurs locally or only through a proxy.

Never attach `.env`, API keys, OAuth tokens, cookies, database files, or raw
provider responses containing private data. See [SECURITY.md](../SECURITY.md)
before reporting a vulnerability. Contributions follow
[CONTRIBUTING.md](../CONTRIBUTING.md).

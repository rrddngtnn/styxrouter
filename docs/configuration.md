# Configuration and authentication

[Documentation](README.md) · [Install](install.md)

## Environment files

For Docker, copy `docker.env.example` to the repository-root `.env`; Compose
uses `env_file`, while `docker run` needs `--env-file .env`. For source startup,
copy it to `apps/server/.env`, where `server:start` runs. Restart the server or
recreate the container after changing its startup environment.

Use the small Docker template for onboarding. The larger upstream
`apps/server/.env.example` includes settings for code paths not mounted by the
Hono host; it is not a list of features enabled in this server.

| Setting | Purpose |
| --- | --- |
| `INITIAL_PASSWORD` | Bootstrap panel password, persisted as a bcrypt hash. Does not replace an existing saved password. |
| `JWT_SECRET` | Signs panel sessions. Missing or blank values prevent login; changing it invalidates existing sessions. |
| `API_KEY_SECRET` | Used to generate and validate machine-format router API keys. Keep it stable while those keys exist. |
| `STORAGE_ENCRYPTION_KEY` | Used to derive the provider-credential encryption key. Generate a separate 64-character hex value and preserve it. |
| `PORT` | Native HTTP port; default `20128`. Does not change the `0.0.0.0` binding. |
| `DATA_DIR` | Data location; Docker sets `/data`. Use an absolute writable path for source installs. |
| `STYX_TRUSTED_PUBLIC_ORIGIN` | Exact canonical public HTTPS origin for management-write origin checks and proxied panel model tests. |
| `AUTH_COOKIE_SECURE` | Set to `true` for Secure session cookies on HTTPS deployments. Do not enable it for plain HTTP local login. |

Generate each secret separately with `openssl rand -hex 32`; use a long unique
password rather than the template value. Restrict environment-file permissions
and keep secrets out of Git, logs, and issue reports.

## Panel sessions and API keys

The panel authenticates with a password and an HTTP-only session cookie.
Management APIs require that session except for public health and auth routes.
The provider workspace's **Test model** uses `POST /api/model-test` with the
session, a configured exact model ID, and a matching browser Origin. It sends a
fixed short prompt and returns success or failure without exposing upstream
output. Charges may apply. Limits are per process: one active probe, five-second
spacing, and a ten-second deadline.

Client inference at `/v1/chat/completions`, `/v1/messages`, and `/v1/responses`
requires a router key in `Authorization: Bearer <key>`. A session alone cannot
call those routes. `GET /v1/models` accepts a valid key or, for panel use, a
session without a key. An invalid supplied key is not replaced by session access.
Model, connection, and usage policies still apply to client keys.

## Reverse proxies

For a public URL such as `https://router.example`, set:

```dotenv
STYX_TRUSTED_PUBLIC_ORIGIN=https://router.example
AUTH_COOKIE_SECURE=true
```

Use your actual origin, with no trailing slash or path. Non-default ports belong
in the origin. Empty, noncanonical, or invalid values reject session-authenticated
management writes. Forwarded headers do not establish a trusted origin. Direct
HTTP browser writes will not match a configured HTTPS origin.

The general management-write check permits requests without Origin for non-browser
compatibility; the model probe always requires it. These checks are not a complete
CSRF defense and do not protect backend network access. See
[origin-check details](reverse-proxy-origin-security.md).

## Storage and encryption

Without `DATA_DIR`, storage normally uses `~/.styx`; an existing legacy directory
takes precedence, and Windows or explicit `XDG_CONFIG_HOME` changes the default.
An unwritable explicit path can fall back to the user default on permission errors;
check startup warnings rather than assuming the intended path was used.

Credential fields use AES-256-GCM when key derivation and encryption succeed.
Missing keys or encryption errors can store plaintext. Setting a key does not
prove that existing data was migrated or every write is encrypted. Preserve the
original key separately from database backups; losing it makes encrypted fields
unreadable. See [SECURITY.md](../SECURITY.md).

Persistent storage needs `bun:sqlite`, `better-sqlite3`, or `node:sqlite`.
File-backed sql.js is disabled; its in-memory mode is not persistent storage.
See [SQLite backend safety](sqljs-file-backend-safety.md).

## Backups

| Setting | Default | Effect |
| --- | --- | --- |
| `STYX_BACKUP_INTERVAL_HOURS` | `24` | Scheduled backup interval; `0` disables scheduling. The scheduler checks hourly. |
| `STYX_BACKUP_KEEP` | `7` | Number of scheduled backups retained; manual backups are not pruned by this setting. |
| `STYX_BACKUP_MIN_FREE_MB` | `512` | Minimum free-space headroom in addition to snapshot space requirements. |

Backups are created under `DATA_DIR/db_backups` and checked for SQLite integrity.
Creation and listing are supported; restoration is not. Do not replace a database
or delete WAL/SHM files manually. Read [restore limitations](sqlite-restore-blocker.md).

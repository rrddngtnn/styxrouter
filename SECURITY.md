# Security policy

StyxRouter brokers live provider credentials — OAuth access/refresh tokens and
API keys. Credential encryption depends on configuration and can fall back to
plaintext; see the limitations below. Treat credential-handling issues as sensitive.

## Reporting a vulnerability

Please report security issues **privately**, not through public issues or pull
requests.

- Open a private vulnerability report via the repository's GitHub Security Advisories tab, or
- Contact the maintainer through the address listed on the repository profile.

Include: affected component, a reproduction, and the impact you observed. You
will get an acknowledgement; please allow a reasonable window for a fix before
any public disclosure.

## Handling of secrets

- When `STORAGE_ENCRYPTION_KEY` is configured and encryption succeeds, provider
  credential fields are encrypted with AES-256-GCM; key derivation uses a fixed
  application salt, not a unique per-deployment salt. Keep the environment key
  secret and backed up separately from the database.
- If the key is absent, key derivation fails, or encryption raises an error, the
  current implementation can store plaintext. Configuring a key alone does not
  guarantee existing credentials were migrated or all new writes are encrypted.
- `.env` is gitignored. Only `.env.example` (no real values) is tracked.
- The pre-publish hygiene gate (`scripts/public-hygiene-gate.py`) scans selected
  Git-listed files, filenames, commit messages and optionally panel and runtime
  surfaces. A skipped check or warning is not release clearance; it does not
  audit historical file contents or untracked release candidates. Review those
  separately before publishing.

## Scope

In scope: credential disclosure, authentication/authorization bypass on the
admin API or `/v1/*` endpoints, injection, and leakage of stored tokens.

Out of scope: issues that require a pre-compromised host or physical access to
the deployment.

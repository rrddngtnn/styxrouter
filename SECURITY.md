# Security policy

StyxRouter brokers live provider credentials — OAuth access/refresh tokens and
API keys — and encrypts them at rest. Treat any issue touching credential
handling as sensitive.

## Reporting a vulnerability

Please report security issues **privately**, not through public issues or pull
requests.

- Open a private vulnerability report via the repository's security advisories, or
- Email the maintainer (see the repository profile).  <!-- operator: pin a real contact here -->

Include: affected component, a reproduction, and the impact you observed. You
will get an acknowledgement; please allow a reasonable window for a fix before
any public disclosure.

## Handling of secrets

- Provider credentials are stored encrypted at rest with a per-deployment
  encryption salt plus a `STORAGE_ENCRYPTION_KEY` supplied via the environment.
  Neither the key nor the salt value should ever appear in source, logs, or any
  committed file.
- `.env` is gitignored. Only `.env.example` (no real values) is tracked.
- The pre-publish hygiene gate (`scripts/public-hygiene-gate.py`) scans the tree,
  commit history, built panel bundle, and (optionally) the live runtime for
  leaked operator identifiers, infrastructure facts, and credential material.
  Run it before publishing or pushing to a public remote.

## Scope

In scope: credential disclosure, authentication/authorization bypass on the
admin API or `/v1/*` endpoints, injection, and leakage of stored tokens.

Out of scope: issues that require a pre-compromised host or physical access to
the deployment.

# StyxRouter

Lean AI model router on Hono + Bun. Serves OpenAI-, Anthropic-, Google-, Tencent-, and Z.ai-shaped backends through OpenAI-style `/v1/chat/completions`, Anthropic-style `/v1/messages` and Responses-style `/v1/responses` endpoints with per-provider OAuth/API-key credential rotation, cooldown-aware account failover, and ZCode/Codex/CBAI/Antigravity client-identity fingerprints for anti-ban resilience.

Ported and lean-refactored from an upstream lean-router line (see **Credits & lineage** below).

## Project status

The router runs as a native **Hono + Bun** server (`apps/server/server/styx.ts`) paired with a standalone **React 19 + Vite 6** administration panel (`apps/panel/`). The package name (`@styxrouter/server`), environment namespace (`STYX_*`), database migration tracking table (`_styx_migrations`), and field-encryption salt use the `styx` namespace. Run the pre-publish hygiene gate (`python3 scripts/public-hygiene-gate.py --repo-root . --panel-dist-dir apps/panel/dist`) before any public push.

## Workspace layout

```
styxrouter/
├── apps/
│   ├── server/        # Hono + Bun host, executors, OAuth, DB, scripts, tests
│   └── panel/         # React 19 + Vite 6 administration SPA
├── scripts/           # Pre-publish hygiene gate and pattern catalog
└── package.json       # Bun workspace root
```

## Model naming and routing

All model IDs, display names, effort variants, and per-account catalog
semantics are documented in [`docs/model-naming.md`](docs/model-naming.md).
Follow that document when adding or changing any model in this repository.

## Supported providers

Retained from upstream and verified end-to-end live in this repo:

| Provider | Transport | Fingerprint |
|---|---|---|
| Codex (OpenAI) | OAuth PKCE browser flow | codex_cli_rs identity, live version drift |
| Antigravity (Google) | OAuth code flow | Hub/IDE/CLI UA profiles + X-Stainless-* + loadCodeAssist bootstrap |
| Kiro (AWS) | AWS SSO device flow | native AWS SDK |
| CodeBuddy Intl (Tencent) | OAuth device flow | CodeBuddy IDE identity headers |
| Z.ai GLM | ZCode OAuth CLI poll + API key | ZCode Start-Plan / Coding-Plan routing + plan family discovery |
| OpenAI-Compatible Nodes | API key / custom baseUrl | Dynamic compatible connectors (e.g. Muse bridge) |

Fail-closed dispatch — any provider ID not in the explicit registry whitelist throws 400 `unsupported_provider` before any executor is instantiated.

## Quick start (from a fresh clone)

```bash
# 1. Install workspace dependencies using Bun 1.4.3 and the committed lockfile
bun install --frozen-lockfile

# 2. Build the administration panel SPA
bun run panel:build

# 3. Create apps/server/.env, then edit it to set INITIAL_PASSWORD and the secrets.
# Generate each 32-byte hex secret with: openssl rand -hex 32
cp docker.env.example apps/server/.env

# 4. Start the server (binds 0.0.0.0:20128 by default)
bun run server:start

# 5. Open the panel at http://127.0.0.1:20128/panel/ and sign in with INITIAL_PASSWORD
```

## SQLite backend compatibility

Persistent deployments require a synchronous SQLite driver (`bun:sqlite` when running with Bun, `better-sqlite3`, or `node:sqlite`). The sql.js fallback supports `:memory:` only; file-backed startup deliberately fails rather than risk stale authorization or lost writes. This also applies to forced sql.js package-boot smoke mode; use a native driver for persistent boot checks. Stop all older sql.js processes before switching an existing database. See [sql.js backend safety](docs/sqljs-file-backend-safety.md).

Backups can be created and listed, but there is currently no supported safe restore command. Do not replace a live database or its WAL/SHM files; see the [restore safety blocker](docs/sqlite-restore-blocker.md).

## Testing

```bash
# TypeScript contract and routing tests (Bun test runner)
bun run server:test
# Single server test: (cd apps/server && bun scripts/test-isolated.ts tests/example.test.ts)
# Do not run server tests with bare `bun test`: files share state and may access your real data.

# Panel unit tests + typecheck
bun run panel:test
bun run panel:typecheck

# Python-side tooling tests (stdlib unittest)
bun run server:test:py
```

## Credits & lineage

StyxRouter derives from upstream projects and contains additional named ports.
Full attribution, inspected source revisions, and unresolved licensing questions
live in [`CREDITS.md`](CREDITS.md). The main lineage includes:

- **OmniRoute** — the lean AI-model-router line this project was ported and
  refactored from; the server engine (`apps/server/open-sse/`) derives from it.
  <https://github.com/diegosouzapw/OmniRoute>
- **9Router** — reference and explicitly attributed source ports for provider
  integrations. <https://github.com/decolua/9router>
- **ZCode** — supplied the CLI client identity and plan-family taxonomy used by
  the Z.ai / GLM integration. <https://zcode.z.ai>

## License

The root [`LICENSE`](LICENSE) records an MIT grant, but the retained tree is not
verified as MIT-only. The former Hailuo executor explicitly ported code
from GPL-3.0-licensed gpt4free and is excluded from this candidate current tree,
not from retained Git history. See [`CREDITS.md`](CREDITS.md) for pinned evidence,
retained notices, and unresolved provenance. These notices do not relicense the
project or establish release clearance.

## Docker

A `Dockerfile`, `docker-compose.yml`, and GitHub Actions multi-arch image publisher (`.github/workflows/release.yml` → `ghcr.io/<owner>/styxrouter:latest`) are included; see [DOCKER.md](DOCKER.md) for the four settings you need and how to run it.

## npm / Bun CLI (`@styxrouter/server`)

The `@styxrouter/server` package is configured to ship a Bun-based `styxrouter` CLI and the compiled administration panel (`prepack` builds `apps/panel/dist` into the tarball). It is not a standalone native binary and requires Bun. The package was not found on the public npm registry on 2026-10-28; installation below requires a published release.

```bash
# Install globally with Bun and run from any directory
bun add -g @styxrouter/server
DATA_DIR=~/.styx INITIAL_PASSWORD=... JWT_SECRET=... API_KEY_SECRET=... STORAGE_ENCRYPTION_KEY=... styxrouter
```

Publishing remains blocked on the provenance and licensing review described in [CREDITS.md](CREDITS.md); the example is not release clearance.

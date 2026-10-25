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
# 1. Install workspace dependencies (server + panel) from the repository root
bun install

# 2. Build the administration panel SPA
npm --prefix apps/panel run build

# 3. Create apps/server/.env with your secrets (generate each 32-byte hex secret with: openssl rand -hex 32)
cp docker.env.example apps/server/.env

# 4. Start the server (listens on :20128 by default)
cd apps/server && bun server/styx.ts

# 5. Open the panel at http://127.0.0.1:20128/panel/ and sign in with INITIAL_PASSWORD
```

## Testing

```bash
# TypeScript contract and routing tests (Bun test runner)
cd apps/server && bun test tests/

# Panel unit tests + typecheck
bun test apps/panel/tests/
npm --prefix apps/panel run typecheck

# Python-side tooling tests (stdlib unittest)
cd apps/server && python3 -m unittest discover -s tests -p 'test_*.py' -v
```

## Credits & lineage

StyxRouter stands on three upstream projects. Full detail lives in
[`CREDITS.md`](CREDITS.md).

- **OmniRoute** — the lean AI-model-router line this project was ported and
  refactored from; the server engine (`apps/server/open-sse/`) derives from it.
  <https://github.com/diegosouzapw/OmniRoute>
- **9Router** — reverse-engineered as a reference for a subset of provider
  integrations. <https://github.com/decolua/9router>
- **ZCode** — supplied the CLI client identity and plan-family taxonomy used by
  the Z.ai / GLM integration. <https://zcode.z.ai>

## License

MIT (see `LICENSE`). Portions are ported from the upstream projects listed under
**Credits & lineage**; see [`CREDITS.md`](CREDITS.md) for the per-subsystem
attribution and SPDX detail.

## Docker

A `Dockerfile` and `docker-compose.yml` are included; see [DOCKER.md](DOCKER.md) for the four settings you need and how to run it.

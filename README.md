# StyxRouter

Lean AI model router on Hono + Bun. Serves OpenAI-, Anthropic-, Google-, Tencent-, and Z.ai-shaped backends through OpenAI-style `/v1/chat/completions`, Anthropic-style `/v1/messages` and Responses-style `/v1/responses` endpoints with per-provider OAuth/API-key credential rotation, cooldown-aware account failover, and ZCode/Codex/CBAI/Antigravity client-identity fingerprints for anti-ban resilience.

Ported and lean-refactored from an upstream lean-router line (see **Credits & lineage** below).

## Project status

Operational rename is **in progress, not complete**. The package name, CLI bin,
and encryption salt have been renamed to `styx*`, but the environment namespace
(`OMNIROUTE_*`), `.env.example`, and a large share of the ported source still
carry the upstream identifier. Treat the upstream name as a structural
identifier that is still being migrated out — not as a shipped rename. Do not
rely on this tree being free of upstream identifiers until the rename cutover
lands and the public-hygiene gate (`scripts/public-hygiene-gate.py`) reports
zero hits.

## Workspace layout

```
styxrouter/
├── apps/
│   ├── server/        # Hono + Bun host, executors, OAuth, DB, scripts, tests
│   └── panel/         # React 19 + Vite 6 administration SPA
├── docs/              # Operational docs (local-only runbooks)
├── evidence/          # Local-only forensics (gitignored)
└── package.json       # Bun workspace root
```

## Supported providers

Retained from upstream and verified end-to-end live in this repo:

| Provider | Transport | Fingerprint |
|---|---|---|
| Codex (OpenAI) | OAuth device flow | codex_cli_rs identity, live version drift |
| Antigravity (Google) | OAuth code flow | 3 UA profiles + X-Stainless-* + loadCodeAssist bootstrap |
| Kiro (AWS) | AWS SSO desktop | native AWS SDK |
| CodeBuddy Intl (Tencent) | API key + session | 11 context headers (X-Conversation-*, X-B3-*, Edge-Tracker, X-Request-From) |
| Z.ai GLM | OAuth CLI poll + API key | 13 ZCode-CLI identity headers + plan family discovery |
| Muse (muse.ai) | API key via bridge | bridge translation layer |

Fail-closed dispatch — any provider ID not in the explicit registry whitelist throws 400 `unsupported_provider` before any executor is instantiated.

## Quick start

```bash
# Install dependencies for the server workspace
cd apps/server && ~/.bun/bin/bun install

# Install dependencies for the panel workspace
cd apps/panel && npm install

# Start the server (listens on :20128 by default)
cd apps/server && ~/.bun/bin/bun server/styx.ts

# Open the panel at http://localhost:20128/panel/
```

## Testing

```bash
# TypeScript contract and routing tests (Bun test runner)
cd apps/server && ~/.bun/bin/bun test tests/

# Python-side tooling tests (stdlib unittest)
cd apps/server && python3 -m unittest discover -s tests -p 'test_*.py' -v
```

## Credits & lineage

StyxRouter stands on three upstream projects. Full detail lives in
[`CREDITS.md`](CREDITS.md).

- **OmniRoute** — the lean AI-model-router line this project was ported and
  refactored from; the server engine (`apps/server/open-sse/`) derives from it.
  <https://TODO.invalid/omniroute> <!-- operator: replace with real URL -->
- **9Router** — reverse-engineered as a reference for a subset of provider
  integrations. <https://TODO.invalid/9router> <!-- operator: replace with real URL -->
- **ZCode** — supplied the CLI client identity and plan-family taxonomy used by
  the Z.ai / GLM integration. <https://TODO.invalid/zcode> <!-- operator: replace with real URL -->

## License

MIT (see `LICENSE`). Portions are ported from the upstream projects listed under
**Credits & lineage**; see [`CREDITS.md`](CREDITS.md) for the per-subsystem
attribution and SPDX detail.

## Docker

A `Dockerfile` and `docker-compose.yml` are included; see [DOCKER.md](DOCKER.md) for the four settings you need and how to run it.

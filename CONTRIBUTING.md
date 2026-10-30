# Contributing to StyxRouter

Thanks for helping. This is a Bun monorepo: `apps/server` (Hono + Bun host) and
`apps/panel` (React 19 + Vite 6 admin SPA).

## Setup

Use Bun 1.4.3 and Python 3. Node.js and npm are needed for npm publishing
and Node-specific external tooling. Work from the repository root. The workspace lockfile is
`bun.lock`; the panel's npm lockfile is not used for the workspace install.
Do not use production credentials or data for development or tests.

```bash
# Install the exact workspace dependency resolutions
bun install --frozen-lockfile

# Build the administration panel SPA
bun run panel:build
```

## Build & test

```bash
# Server TypeScript check and contract + routing tests
bun run server:typecheck
bun run server:test
# Single server test: cd apps/server && bun scripts/test-isolated.ts tests/example.test.ts
# Avoid bare `bun test` for server tests: it shares module state and may access real data.

# Panel unit tests + typecheck
bun run panel:test
bun run panel:typecheck

# Python-side tooling tests (stdlib unittest)
bun run server:test:py

# Panel production build
bun run panel:build
```

Run `python3 -m unittest discover -s tests -p 'test_*.py' -v` from the
repository root to test the hygiene gate itself. Some integration tests bind
local ports; run them in an isolated environment, not against a live instance.
Never run ad-hoc scripts that import server database modules directly: express
probes as `.test.ts` files and invoke the isolated runner above, which sets
private HOME, DATA_DIR and temporary paths before imports. The database guard
recognizes common scratch/test/probe entrypoint names, but is only an accident
guard: it cannot detect every script and its environment marker is not a security
boundary. Do not set `STYX_ISOLATED_TEST` manually or use real data for probes.

Browser fixtures use `node:test` and `.browser.mjs` names. Bun 1.4.3 does not
run them directly as `bun test` files; direct `bun file.mjs` also rejects their
hooks. A Bun test-wrapper experiment launched Playwright Chromium but the brand
suite did not pass (one test passed, then a shell test timed out). Until these
fixtures are migrated and verified, use Node's `node --test` for browser tests
with a local fixture-only panel server and installed Playwright Chromium. Keep
browser test filenames ending in `.browser.mjs`, not `.browser.test.mjs`, so
`panel:test` remains server-independent. For the navigation landmark fixture:

```bash
# Terminal 1, from the repository root (fixture server only)
cd apps/panel && NODE_ENV=development bun run dev --host 127.0.0.1 --port 5198 --strictPort
# Terminal 2, from the repository root
node --test apps/panel/tests/navigation-landmark-language.browser.mjs
```

Set `PLAYWRIGHT_MODULE` to a Playwright module path and `CHROMIUM_PATH` to a
Chromium executable if they are not available through the default installation.
`PANEL_TEST_URL` can point to another loopback fixture server under `/panel/`.

Keep changes minimal and focused. Prefer the standard library and existing
helpers over new dependencies. Explain the motivation and validation in your
pull request, link relevant issues, and add tests for behavior changes. The root
[license](LICENSE) does not resolve the provenance and distribution obligations
of all retained third-party code; see [CREDITS.md](CREDITS.md). Follow the
[code of conduct](CODE_OF_CONDUCT.md).
Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`,
`fix:`, `docs:`, `refactor:`, `test:`, `chore:`. One logical change per commit.

## Before you push to a public remote

Run the pre-publish hygiene gate from the repo root and inspect its full report:

```bash
python3 scripts/public-hygiene-gate.py --repo-root . --panel-dist-dir apps/panel/dist
```

The gate reports matches in selected Git-listed surfaces and blocks patterns
classified as fatal. A passing exit status can still include warnings or skipped
checks; inspect those, untracked release candidates, and historical file contents
separately. Attribution is not a complete license audit. If a match is legitimate,
use a narrowly scoped entry in `scripts/hygiene_allowlist.json`; do not hide a
real leak.

Internal planning artefacts (`specs/`, `plans/`, local runbooks, forensic
evidence) are gitignored and must stay local.

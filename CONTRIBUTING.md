# Contributing to StyxRouter

Thanks for helping. This is a Bun monorepo: `apps/server` (Hono + Bun host) and
`apps/panel` (React 19 + Vite 6 admin SPA).

## Setup

```bash
# server
cd apps/server && ~/.bun/bin/bun install
# panel
cd apps/panel && npm install
```

## Build & test

```bash
# TypeScript contract + routing tests
cd apps/server && ~/.bun/bin/bun test tests/

# Python-side tooling tests (stdlib unittest)
cd apps/server && python3 -m unittest discover -s tests -p 'test_*.py' -v

# Panel build
cd apps/panel && npm run build
```

Keep changes minimal and focused. Prefer the standard library and existing
helpers over new dependencies.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`,
`fix:`, `docs:`, `refactor:`, `test:`, `chore:`. One logical change per commit.

## Before you push to a public remote

Run the pre-publish hygiene gate from the repo root. It must report no hits:

```bash
python3 scripts/public-hygiene-gate.py --repo-root . --panel-dist-dir apps/panel/dist
```

The gate blocks operator-identifying strings, infrastructure facts, private
planning vocabulary, and upstream structural identifiers from entering a public
surface. Upstream project names are permitted only in `README.md` under
"Credits & lineage" and in `CREDITS.md`. If the gate flags a legitimate match,
tighten the pattern or add a scoped entry to `scripts/hygiene_allowlist.json` —
do not loosen a pattern to hide a real leak.

Internal planning artefacts (`specs/`, `plans/`, local runbooks, forensic
evidence) are gitignored and must stay local.

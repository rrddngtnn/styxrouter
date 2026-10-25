# Credits & lineage

StyxRouter is a derivative work. This file is the authoritative record of what
was ported, from where, and under which licence. The upstream project names
appear here and in the README "Credits & lineage" section only — everywhere
else in the tree they are being migrated out as structural identifiers.

All ported portions are under the MIT licence (SPDX: `MIT`), matching this
repository's `LICENSE`.

## OmniRoute

<https://github.com/diegosouzapw/OmniRoute>

The lean AI-model-router line StyxRouter was ported and lean-refactored from
(the 3.8.x line). Derived subsystems:

- `apps/server/open-sse/` — the dispatch engine, executors, handlers, and SSE
  transformer layer.
- OAuth provider integrations and the credential-rotation / account-failover
  logic.
- The `.env` configuration contract (migrated to the `STYX_*` namespace).

SPDX of derived files: `MIT`. Port date: 2026-10 (see git history of this repo
for the exact import commit).

## 9Router

<https://github.com/decolua/9router>

Reverse-engineered as a reference for a subset of provider integrations
(provider taxonomy and a downstream `ninerouter` executor). No bulk source was
copied; this is a behavioural reference, with any retained snippets under `MIT`.

## ZCode

<https://zcode.z.ai>

Supplied the CLI client-identity headers and the plan-family taxonomy used by
the Z.ai / GLM integration (`apps/server/open-sse/executors/zcode.ts`,
`glm.ts`, and related config). Retained portions under `MIT`.

## Individual contributors

Contributor-level attribution from the upstream git histories is preserved in
file-level SPDX headers where the licence requires it. This document does not
duplicate that per-file record.

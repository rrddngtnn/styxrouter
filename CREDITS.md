# Credits & lineage

StyxRouter is a derivative work. This file records verified upstream licences,
known ports, and unresolved provenance. It is not a complete source inventory or
a release clearance. Retain source attribution and legal notices even where
structural identifiers are renamed.

The root `LICENSE` records an MIT grant; it does not replace third-party licences
or establish an MIT-only licence for this tree. The Hailuo/gpt4free port below
has GPL-3.0 source provenance. Its exact import revision and the obligations for
a combined distribution remain unresolved. Do not describe this tree as MIT-only
or treat the retained notices as release clearance. No project-wide licence
change is made here; installation and hygiene checks cannot settle licensing.
The Docker and npm publication jobs are deliberately disabled for all triggers.
Before enabling either job, resolve outstanding source and asset provenance,
applicable licences and distribution obligations, retain required notices in each
artifact, and record release approval. A passing hygiene gate is not approval.

## OmniRoute

<https://github.com/diegosouzapw/OmniRoute>

The lean AI-model-router line StyxRouter was ported and lean-refactored from
(the 3.8.x line). Derived subsystems:

- `apps/server/open-sse/` — the dispatch engine, executors, handlers, and SSE
  transformer layer.
- OAuth provider integrations and the credential-rotation / account-failover
  logic.
- The `.env` configuration contract (migrated to the `STYX_*` namespace).

The [v3.8.0 licence](https://github.com/diegosouzapw/OmniRoute/blob/39526b2b8c72c86671cdbad6575d9ee3e8d2f95e/LICENSE)
is MIT, copyright (c) 2026 diegosouzapw; its notice is retained in
`apps/server/LICENSE`. That licence alone does not establish the licences of
third-party code vendored into the upstream tree. The local initial import is
`ed798cb` (2026-10-24); the exact imported upstream revision is not recorded here.

## 9Router

<https://github.com/decolua/9router>

The [published licence](https://github.com/decolua/9router/blob/3a978a631ad65529c06e48ce495092d5bba29f46/LICENSE)
is MIT, copyright (c) 2024-2026 decolua and contributors. The complete notice is
retained in `apps/server/licenses/9router-MIT.txt`.

This is more than a behavioural reference: local source explicitly identifies
ports, including `open-sse/executors/kiroThinking.ts` (PR #1273),
`open-sse/executors/zed-hosted.ts` (PR #2328), and
`src/app/api/oauth/codex/import/route.ts` (PR #1257), relative to `apps/server/`.
These comments establish a need for attribution; they are not a complete audit
of copied files or the historical licence of every imported revision.

## Hailuo / gpt4free — GPL source provenance, unresolved release blocker

The retained file [`hailuo-web.ts`](apps/server/open-sse/executors/hailuo-web.ts)
explicitly says its request signing and SSE event shape were ported 1:1 from
`g4f/Provider/needs_auth/mini_max/{HailuoAI,crypt}.py` (lines 17–20). Its
`getBodyToYy` and `generateYyHeader` implementations (lines 78–93) correspond to
[`crypt.py` at e3127d4](https://github.com/xtekky/gpt4free/blob/e3127d4a261a85abb9cdcf8d7821e7bf0097ae44/g4f/Provider/needs_auth/mini_max/crypt.py#L27-L50):
newline removal, concatenated MD5 body fields, percent-encoded path, timestamp
hash, and the `ooui` suffix. The provider implementation is
[`HailuoAI.py`](https://github.com/xtekky/gpt4free/blob/e3127d4a261a85abb9cdcf8d7821e7bf0097ae44/g4f/Provider/needs_auth/mini_max/HailuoAI.py).

The [licence at that inspected revision](https://github.com/xtekky/gpt4free/blob/e3127d4a261a85abb9cdcf8d7821e7bf0097ae44/LICENSE)
is the GNU GPL version 3. Its complete text is retained in
[`gpt4free-GPL-3.0.txt`](apps/server/licenses/gpt4free-GPL-3.0.txt). This identifies
the previously unnamed GPL-source port; it does not establish the exact imported
revision, a GPL `only`/`or-later` choice, or a licence for the combined work.
Those questions need resolution before distribution. Adding the licence text is
not a compliance determination, a clean-room replacement, or a relicense.

Other gpt4free references remain in `qwen-web.ts` and `gemini-web.ts`; their
comments alone do not establish whether code was copied or independently
implemented. Their provenance and any applicable notices remain to be audited.

## gcf-typescript — historical MIT source, exact import unresolved

Four files in
[`open-sse/services/compression/engines/headroom/gcf/`](apps/server/open-sse/services/compression/engines/headroom/gcf/)
identify themselves as vendored from `blackwell-systems/gcf-typescript` and carry
MIT SPDX headers. Historical revision
[`a5ee0d4`](https://github.com/blackwell-systems/gcf-typescript/tree/a5ee0d400de441e8098eea083168fd25100a41b4/src)
contains corresponding `generic.ts`, `decode_generic.ts`, and `scalar.ts`; its
[licence](https://github.com/blackwell-systems/gcf-typescript/blob/a5ee0d400de441e8098eea083168fd25100a41b4/LICENSE)
is MIT, copyright (c) 2026 Dayna Blackwell. That complete notice is retained in
[`gcf-typescript-historical-MIT.txt`](apps/server/licenses/gcf-typescript-historical-MIT.txt).
The local files are modified, not byte-identical to that snapshot, and no exact
import revision has been established.

Upstream later [changed to Apache-2.0](https://github.com/blackwell-systems/gcf-typescript/commit/66ac3e87448d46248e7418ca203a3375cf0ff2a9)
on 2026-09-23; that commit explicitly says already-released MIT versions stay
MIT. Neither today's upstream licence nor the local SPDX labels alone settle
which revisions all local modifications came from. No local licence header is
changed by this audit.

## Free Claude Code — historical MIT reference, exact import unresolved

[`streamRecovery.ts`](apps/server/open-sse/services/streamRecovery.ts) identifies
a port of `core/anthropic/stream_recovery.py`; related attribution also remains
in `open-sse/config/constants.ts` and `open-sse/config/searchRegistry.ts`.
The historical
[`e79b430` source](https://github.com/Alishahryar1/free-claude-code/blob/e79b430cc27b63c690b5d782b045c213b9a873c5/core/anthropic/stream_recovery.py)
contains `RecoveryHoldbackBuffer`, the 0.75-second/65,536-byte defaults, and
continuation helpers matching the named local port. Its
[licence](https://github.com/Alishahryar1/free-claude-code/blob/e79b430cc27b63c690b5d782b045c213b9a873c5/LICENSE)
is MIT, copyright (c) 2026 Ali Khokhar; the complete notice is retained in
[`free-claude-code-historical-MIT.txt`](apps/server/licenses/free-claude-code-historical-MIT.txt).

Upstream [switched to AGPL-3.0-only](https://github.com/Alishahryar1/free-claude-code/commit/81cc4e0d22cce4147f97700c732a2a8f5bd5712f)
on 2026-09-24; the
[inspected later licence](https://github.com/Alishahryar1/free-claude-code/blob/56ee72ea5722cb81de9b1905627897b5e77581ce/LICENSE)
explicitly names that SPDX identifier. The historical MIT reference is not proof
that every retained local port came from that revision. Exact import provenance
and any later copied changes remain unresolved; this audit does not label the
local module AGPL or assume the later licence retroactively replaced MIT.

## ZCode

<https://zcode.z.ai>

Supplied the CLI client-identity headers and the plan-family taxonomy used by
the Z.ai / GLM integration (`apps/server/open-sse/executors/zcode.ts`,
`glm.ts`, and related config).
[`zai-org/ZCode`](https://github.com/zai-org/ZCode) publishes an
[Apache-2.0 licence at 3c5b227](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/LICENSE),
not MIT. That repository's licence does not by itself establish whether the
local integration copied source from it or which revision was used. The
provenance and licence of any retained source remain unresolved; no local code
is relabelled on this evidence.

## Other provenance and assets still requiring review

The port inventory is not exhaustive. Named source references also include
`ndycode/codex-multi-auth`, `szcharlesji/raycast-relay`, `composer-api`, and
`javargasm/pi-kiro`. Their exact imported revisions and notices are not established
by this audit. The name `open-sse/vendor/codex-chatgpt-web/` alone is not evidence
of a particular upstream repository or licence.

Brand assets carry a separate
[`LICENSE-NOTICE.txt`](apps/panel/public/brand/LICENSE-NOTICE.txt). It describes
commercial use tied to the logo, not an MIT grant; its presence does not establish
an open-source redistribution grant. Do not subsume these assets under the root
MIT notice.

The retained notice files and their evidence manifest are in
[`apps/server/licenses/`](apps/server/licenses/). The server package includes
that directory. The manifest's pinned URLs and SHA-256 digests identify inspected
upstream files, not a reconstructed import history or complete dependency audit.

## Individual contributors

Some files carry individual SPDX headers; attribution completeness has not been
independently verified. Review upstream histories and notices before release.

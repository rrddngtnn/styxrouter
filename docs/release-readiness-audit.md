# OSS release licensing and provenance audit

## Status and scope

**Release approval withheld: verified notice omission and unresolved source/asset rights remain.** This is an evidence inventory, not legal advice, a project relicense, or a finding that every unresolved component is incompatible with open source.

Audited working tree based on `e20d18e02d2c433107fc42c2f734ab1bb716dff6`. Only this new document was written inside the repository. Concurrent admin, Providers, Tools and Quota edits were not reviewed or changed. No implementation, asset, attribution, licence, manifest or workflow was changed; no commit, push or publication was performed.

Read `CREDITS.md`, root/server `LICENSE`, every retained upstream licence, `apps/server/licenses/{README.md,upstream-sources.json}`, workspace manifests, asset notices, release workflow and Dockerfile. Retrieved immutable public upstream licence/source snapshots and both cited historical licence-change commits. All 11 upstream manifest entries fetched successfully and matched their recorded byte lengths and SHA-256 digests; the four retained licence texts also matched their upstream bytes. Evidence-only manifest entries that are not local files are explicitly explained in `apps/server/licenses/README.md:15–18`; their absence is not itself a missing-notice defect.

## Remediation update

The missing vendor MIT notice identified below has now been retained as
`apps/server/licenses/codex-chatgpt-web-MIT.txt`, with its pinned upstream URL,
byte length and SHA-256 in `upstream-sources.json`. Credits and the notice README
were corrected. The finding below records the pre-remediation audit state;
artifact inclusion still requires release packaging verification. This resolves
the source-tree notice omission only, not GPL treatment or brand/provenance gates.

## Verified blockers and approval gates

### 1. Missing MIT notice for an explicitly pinned vendored implementation

**Concrete defect, source publication and packaged distribution.** `apps/server/open-sse/vendor/codex-chatgpt-web/bridge.ts:1` identifies `miuuyy/codex-chatgpt-web` commit `55592fca0ba19a27f1b769cec8fff61ff340a785` and MIT. Equivalent attribution appears across the vendor directory, including `adapters/base.ts:1`, `responses/schema.ts:1` and `usage/totals.ts:1`.

The pinned upstream licence names **Copyright (c) 2026 codex-chatgpt-web contributors** and requires the copyright and permission notice in copies or substantial portions.[16] No tracked file contained that copyright string when searched; no corresponding licence exists in `apps/server/licenses/`, and the npm dry-run includes 28 files from this vendor directory but no vendor MIT notice. A source comment saying “(MIT)” is not the complete copyright and permission notice.

`CREDITS.md:133–137` and `apps/server/licenses/README.md:24–25` currently say the directory name alone does not establish its source. That cautious statement is incomplete in light of the explicit pinned source headers; those headers now permit a concrete attribution correction.

**Action for approval:** retain a verbatim copy of the inspected pinned MIT notice, record its hash and source in the evidence manifest, update Credits/notice inventory and verify inclusion in source, npm and Docker artifacts. Suggested new path: `apps/server/licenses/codex-chatgpt-web-MIT.txt`. Do not remove the implementation or headers. This audit does not make that change.

### 2. Hailuo has verified GPL source provenance; combined-work treatment is undecided

**Verified provenance, unresolved release decision—not proof the entire repository is automatically GPL.** `apps/server/open-sse/executors/hailuo-web.ts:17–20` says signing/SSE are ported “1:1” from g4f; lines 78–93 reproduce the named body-hash and signature structure. Pinned upstream `crypt.py:27–50` has the same percent-encoded path, timestamp MD5, newline stripping, concatenated MD5 fields and `ooui` suffix.[6] The pinned upstream licence is GNU GPL version 3, byte-identical to `apps/server/licenses/gpt4free-GPL-3.0.txt`.[2]

This is shipped and integrated, not only an unused reference: `apps/server/open-sse/executors/index.ts:69,211,365` imports, registers and exports the executor; `apps/server/open-sse/config/providers/registry/minimax/web/index.ts:20` selects it; npm dry-run includes `open-sse/executors/hailuo-web.ts`.

The retained GPL text distinguishes source conveyance (§5, lines 208–243) from non-source conveyance (§6, lines 245–337). Section 5 requires modification notices and whole-work licensing where its covered-work conditions apply; section 6 addresses Corresponding Source for object-code conveyance. Merely adding GPL text does not determine the boundary of the covered work or satisfy those requirements. Generic GPL text does not establish this project's `only` versus `or-later` grant.

**Owner decisions:** authorize a licence/combined-work review and an appropriate compliant distribution model; seek an alternative grant from relevant rightsholders; or separately approve an independently implemented replacement or scoped exclusion after dependency and provenance review. None is selected here. Do not silently relicense the tree, delete the provider or call a translation “clean room.” Keep publication held pending a documented decision for source releases as well as artifacts.

### 3. Brand redistribution/modification permission is not established by supplied notices

**Verified evidence gap, not a finding that the owner lacks rights.** `apps/panel/public/brand/LICENSE-NOTICE.txt:3–4` and `STYXROUTER-BRAND-KIT-NOTICE.txt:3–4` grant commercial use “for commercial projects tied to this logo”; neither supplies explicit general downstream redistribution, sublicensing or modification terms. Both disclaim uniqueness/trademark certainty at lines 6–7. `brand/PROVENANCE.txt:1–10` records an operator-supplied ZIP and modifications, not a broader licence grant.

Affected tracked paths: `apps/panel/public/brand/styx-icon.svg`, `styx-wordmark.svg`, `styx-lockup-original.svg`, `styx-lockup.svg`, `styx-lockup-dark.svg`, `apple-touch-icon.png`, and `apps/panel/public/favicon.ico`. The modified lockups are specifically described in `PROVENANCE.txt:2–8`.

**Owner decisions:** supply the original acquisition terms/proof of permission covering public source redistribution, modified versions, packaged copies and downstream recipients; explicitly approve a separate asset licence/exclusion strategy consistent with those rights; or approve replacement artwork with documented rights. Do not infer MIT from root `LICENSE`, remove assets, or assert trademark clearance. Source publication already redistributes tracked art; this is not only a binary issue.

### 4. Historical MIT references do not identify every imported revision

**Unresolved provenance gates, not confirmed Apache/AGPL violations.**

| Component and exact local scope | Verified evidence | Required resolution |
| --- | --- | --- |
| GCF codec: `apps/server/open-sse/services/compression/engines/headroom/gcf/{index,generic,decode_generic,scalar}.ts` | Vendored/MIT headers at the file openings; used by `headroom/tabular.ts:18`. Pinned `a5ee0d400de441e8098eea083168fd25100a41b4` licence is MIT, copyright Dayna Blackwell.[3] Upstream `66ac3e87448d46248e7418ca203a3375cf0ff2a9` changed to Apache-2.0 on 2026-09-23 and expressly preserves already-released MIT versions.[12] | Reconstruct imported revisions and later borrowed edits, especially the version/spec fixes listed in `gcf/index.ts:3–5`. Use historical MIT only for covered source; if later Apache source was copied, inspect its NOTICE and modification obligations. Do not relabel from current upstream alone. |
| Free Claude Code: `apps/server/open-sse/services/streamRecovery.ts:4`, `open-sse/config/constants.ts:342`, `open-sse/config/searchRegistry.ts` | Historical `e79b430cc27b63c690b5d782b045c213b9a873c5` licence is MIT, copyright Ali Khokhar.[4] Upstream change `81cc4e0d22cce4147f97700c732a2a8f5bd5712f` explicitly switches to AGPL-3.0-only on 2026-09-24; later inspected licence explicitly names that identifier.[13][5] | Identify each port's source revision and any post-change copied edits. Historical MIT remains evidence of a grant at that snapshot, not all later source. If AGPL-covered edits are retained, assess distribution and network-use obligations before approving deployment/release; no such applicability is established here. |

Local commit history for Hailuo begins at `f17baea` (2026-10-24). `git rev-parse --verify 'ed798cb^{commit}'` fails in this checkout, whereas `CREDITS.md:36` calls `ed798cb` the initial import. Treat that identifier as unverified locally, not as reconstructed provenance. Locate archived import evidence or correct the historical statement in a separately approved attribution change. An import date after an upstream licence change alone does not prove which version was copied.

## Actionable remainder inventory

These are review items, not established violations or exhaustive clearance:

| Source / assets | Exact local evidence and next action |
| --- | --- |
| OmniRoute | `CREDITS.md:19–36`; broad `apps/server/open-sse/` lineage. `apps/server/LICENSE` exactly matches inspected `39526b2b8c72c86671cdbad6575d9ee3e8d2f95e` MIT notice.[14] Recover exact import revision and inherited third-party notices; upstream MIT does not erase nested licences. |
| 9Router | `apps/server/licenses/9router-MIT.txt` matches pinned `3a978a631ad65529c06e48ce495092d5bba29f46` MIT notice.[1] Explicit ports include `apps/server/open-sse/executors/{kiroThinking,zed-hosted}.ts`, `open-sse/shared/zedAuth.ts`, and `src/app/api/oauth/codex/import/route.ts`. Map PR/commit-based ports to historical grants and contributor notices; retain existing attribution. |
| Additional gpt4free references | `apps/server/open-sse/executors/qwen-web.ts:22`, `gemini-web.ts:278,285`; latter also names `HanaokaYuzu/Gemini-API`. Compare implementations with identified snapshots before claiming copied code or an applicable licence. |
| ZCode | `apps/server/open-sse/executors/{zcode,glm}.ts`, `open-sse/config/zcode_system.json`, `CREDITS.md:117–129`. Pinned `zai-org/ZCode` licence is Apache-2.0, not MIT.[15] Establish whether copyrightable source/prompts were copied, then retain any applicable notices; identity/header interoperability alone does not prove copying. |
| codex-multi-auth | `apps/server/open-sse/services/tokenRefresh/rotationMap.ts:18` names `ndycode/codex-multi-auth` and `lib/refresh-queue.ts:218–248`; also `tokenRefresh/providers/codex.ts:33`. Resolve pinned source and historical licence, compare and retain required notice. |
| Raycast relay | `apps/server/open-sse/services/raycast.ts:4` explicitly names `szcharlesji/raycast-relay`. Resolve revision, source extent, licence and notice. |
| composer-api | `apps/server/open-sse/executors/cursor/prompt.ts:12,33–34`, `open-sse/executors/cursor.ts:108–121`; establish repository identity and copied directives/helpers, not only a project nickname. |
| pi-kiro | `apps/server/open-sse/translator/request/openai-to-kiro.ts:990` and `open-sse/executors/kiro.ts:589` name `javargasm/pi-kiro`. Pin and compare sources and notices. |
| Provider icons | `apps/panel/src/components/provider-icon-NOTICE.md:3–4` records pinned Simple Icons CC0 provenance and trademark caveat. This audit did not independently compare each SVG path to that source. Carry applicable provenance into built distributions; do not conflate trademark rights with copyright permissions. |
| Dependencies / runtimes | `bun.lock`, `apps/panel/package-lock.json`, `apps/{server,panel}/package.json`, root `package.json`. Produce a resolved, per-version direct/transitive and optional-dependency licence inventory for actual releases; review `sharp`, `sql.js`, `xxhash-wasm`, browser/runtime/native packages and downloaded artifacts with their bundled components. Manifest names alone establish no incompatibility. Docker base layers need their own notice/source assessment. No complete SBOM or dependency compliance review was performed. |

## Source publication versus npm and binary/container release

- **Public Git/source archive:** includes tracked source, notices and brand assets; publication is not exempt merely because no compiled binary exists. Root `LICENSE:1–22` records an MIT grant, not overriding permission for third-party portions. Root `package.json:6` points to Credits instead of claiming MIT-only. Resolve the verified vendor notice omission, GPL treatment and asset rights before approving this tree as a distributable OSS release.
- **npm server:** `apps/server/package.json:9–35` includes source and `licenses/`; line 55 points to `licenses/README.md`. That is a disclosure pointer, not an SPDX clearance. Root `CREDITS.md` and root `LICENSE` are not shipped by this package. The dry-run included server `LICENSE`, all six `licenses/` entries and GPL-source executor/vendor source, but **zero `panel/` files**. This validates current notice selection only, not the built panel or normal lifecycle result.
- **Lifecycle caution:** `apps/server/package.json:61–62` builds/copies panel and removes/replaces `panel/` during packing. This audit intentionally used `npm pack --dry-run --ignore-scripts --json` with npm cache outside the repository; it did not run those mutating hooks. Repeat the real build/pack in an isolated approved release checkout and inspect actual tarball notices, panel art, compiled icon attribution and source correspondence.
- **Docker:** `Dockerfile:27–30` copies production dependencies, server tree and built panel, but does not explicitly copy root Credits/root licence. Server notices are included by the server-tree copy, subject to build-context exclusions. Verify the actual image, copied dependencies and base-image obligations rather than treating Dockerfile inspection as proof. Compiled/minified panel and any other object-code portions require separate source/notice assessment where applicable; a container can contain both source and non-source forms.
- **Hosted service:** not equivalent to conveying an npm tarball. The inspected GPL definition distinguishes mere network interaction from transferring copies. Any AGPL analysis is conditional on first proving applicable AGPL-source incorporation; no such conclusion is made for the local Free Claude Code port.

## Existing release guard and acceptance checklist

`.github/workflows/release.yml:20–21,63–64` sets both publishing jobs to `if: ${{ false }}` for all configured triggers, including manual dispatch. This is a verified local guard only; it does not prevent manual npm/Docker publication or source pushes, and remote branch settings were not examined. Keep the guard until responsible-owner approval, not merely a passing test/build/hygiene scan.

Before approval, record:

1. Each retained third-party source's identity, inspected/imported commit distinction, licence grant, local file mapping and required notices.
2. The pinned codex-chatgpt-web MIT notice in all artifacts, with corrected provenance inventory.
3. Owner/legal decision for Hailuo combined-work licensing, source notices and any applicable Corresponding Source delivery.
4. GCF and Free Claude Code historical provenance resolution or approved alternative, without retroactive licence assumptions.
5. Brand rights covering the intended public/source/artifact scope or an explicitly approved asset plan.
6. Dependency/runtime/base-image inventory and verified notices for the exact package/image, plus source delivery where required.
7. Artifact-specific approval naming the release commit and evidence; only then a separate deliberate change to publishing controls.

Verification performed: immutable upstream downloads/digest comparison; tracked-content search for missing vendor copyright; source/header and registration inspection; read-only npm dry-run (exit 0, 2,084 entries, no bundled dependencies). This is not a clean-build, actual-image, hosted-CI, full-history or complete licence-compatibility audit. No clearance is granted.

## Sources

[1] https://raw.githubusercontent.com/decolua/9router/3a978a631ad65529c06e48ce495092d5bba29f46/LICENSE — 9router-MIT.txt
    > "Copyright (c) 2024-2026 decolua and contributors"
[2] https://raw.githubusercontent.com/xtekky/gpt4free/e3127d4a261a85abb9cdcf8d7821e7bf0097ae44/LICENSE — gpt4free-GPL-3.0.txt
    > "GNU GENERAL PUBLIC LICENSE"
[3] https://raw.githubusercontent.com/blackwell-systems/gcf-typescript/a5ee0d400de441e8098eea083168fd25100a41b4/LICENSE — gcf-typescript-historical-MIT.txt
    > "Copyright (c) 2026 Dayna Blackwell"
[4] https://raw.githubusercontent.com/Alishahryar1/free-claude-code/e79b430cc27b63c690b5d782b045c213b9a873c5/LICENSE — free-claude-code-historical-MIT.txt
    > "Copyright (c) 2026 Ali Khokhar"
[5] https://raw.githubusercontent.com/Alishahryar1/free-claude-code/56ee72ea5722cb81de9b1905627897b5e77581ce/LICENSE — free-claude-code-current-AGPL-3.0-only.txt
    > "Copyright (c) 2026 Ali Khokhar
SPDX-License-Identifier: AGPL-3.0-only"
[6] https://raw.githubusercontent.com/xtekky/gpt4free/e3127d4a261a85abb9cdcf8d7821e7bf0097ae44/g4f/Provider/needs_auth/mini_max/crypt.py — g4f-crypt.py
    > "combined_string = f"{encoded_path}_{body_to_yy}{time_hash}ooui""
[12] https://api.github.com/repos/blackwell-systems/gcf-typescript/commits/66ac3e87448d46248e7418ca203a3375cf0ff2a9 — gcf-license-change.json
    > "Already-released MIT versions stay MIT;"
[13] https://api.github.com/repos/Alishahryar1/free-claude-code/commits/81cc4e0d22cce4147f97700c732a2a8f5bd5712f — free-claude-license-change.json
    > "Switch project license to AGPL-3.0-only"
[14] https://raw.githubusercontent.com/diegosouzapw/OmniRoute/39526b2b8c72c86671cdbad6575d9ee3e8d2f95e/LICENSE — OmniRoute-MIT.txt
    > "Copyright (c) 2026 diegosouzapw"
[15] https://raw.githubusercontent.com/zai-org/ZCode/3c5b227649371507ddc4eb46ac5133afe6db1cab/LICENSE — ZCode-Apache.txt
    > "Apache License
                           Version 2.0, January 2004"
[16] https://raw.githubusercontent.com/miuuyy/codex-chatgpt-web/55592fca0ba19a27f1b769cec8fff61ff340a785/LICENSE — codex-chatgpt-web pinned LICENSE
    > "The above copyright notice and this permission notice shall be included in all"

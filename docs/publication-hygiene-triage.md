# Historical publication hygiene triage

> This document records the earlier triage, not the current scanner interface or
> clearance. The explicit private overlay and content-bound historical/bundle
> review mechanism now supersede the interface limitation described below. See
> `publication-hygiene.md` for the supported options and current review rules.


## Scope and disposition

This is a current-tree triage, not publication clearance. Only the allowlist,
this document, and a content-preserving test filename change belong to this
correction. No original history, scanner rules, runtime source, public encryption
salt, or third-party attribution is changed. No commit, push, production database
access, network inference, service restart, or runtime request is authorized.

The supplied baseline report (`20261103T054500Z`) contains 556 tracked/index
findings: **46 fatal and 510 warn**, not 556 blockers. Historical findings are
2,215: **191 fatal and 2,024 warn**. It also reports one fatal filename, one fatal
commit-metadata/message finding, 12 fatal bundle findings, and a skipped runtime
scan. Repeated index/working-tree findings are not separate affected files.

The checkout advanced before this triage ran: the first local scan used HEAD
`fbeea4c`, with additional harness and release-audit documentation. Its counts
therefore must not be compared to the baseline as if only this correction changed
source. That scan reported 606 tracked/index findings (86 fatal, 520 warn) and
2,285 historical findings (237 fatal, 2,048 warn). Private operator patterns were
loaded. Redacted machine reports remain in private scratch, outside this tree.

## Bounded current-tree exceptions

The private `P-VOCAB-HERMES` matcher recognizes a public agent product name and
its integration selector. Reviewed matches in the tools catalog, generated-client
branch, compatibility table, tests, and connection guide describe an external
agent harness. They are not evidence of an internal operator session. Preserve
those public integration names; do not rename dispatch selectors or client paths.

Candidate exception locations for this pattern were reviewed at these exact lines:

- `apps/panel/src/pages/Tools.tsx`: 21, 79, 80, 82, 228, 231, 236, 770.
- `apps/panel/tests/tools-ui.test.tsx`: 43, 69, 76.
- `docs/harness-connections.md`: 23, 29.

These product-name exceptions are **not installed**. A trial with these bounded
entries caused the missing-private-catalog regression test to fail: the loader
rejects allowlist patterns unknown to the public catalog when private patterns
are absent. The trial entries were removed, preserving public-only operation.
The owner must choose an independently reviewed private allowlist overlay or a
scanner-interface change in a separately authorized task; do not weaken rules
or rename the public harness to conceal this configuration limitation.

Two additional `P-STRUCT-OMNI` entries cover only lines 67 and 121 of
`docs/release-readiness-audit.md`: a licence-provenance row and pinned licence
reference. These are attribution, not obsolete runtime branding. Existing
warn-level legal/provider references and public salt findings are preserved.
No new whole-file, wildcard, historical-object, bundle, operator-path, port, or
IP exception is added. Line bounds must be re-reviewed after edits: the scanner
has no content fingerprint and a moved line may stop matching its exception.

The legacy-prefixed power-features test filename is replaced by
`apps/server/tests/power-features.test.ts`, with identical file bytes. The old
tracked path still exists in the index until the owner stages a reviewed rename;
the filename gate enumerates cached paths even when their working file is gone.
No index mutation is performed here. A current-tree rename cannot remove the old
name from reachable history.

## Findings that must remain blocked

- Tools source and tests contain port examples matched by private infrastructure
  patterns, plus a public dirty-fixture IP canary. These are examples, not proof
  of a live listener, but no infrastructure exception is granted here. The owner
  must choose neutral examples or explicitly justify each bounded exception.
- The connection guide contains absolute operator home paths in its verification
  commands (lines 79 and 83 in the reviewed version). These are genuine operator
  identifiers, not agent product names. Replace with portable executable lookup
  in a separately owned documentation correction; do not allowlist them.
- Existing panel build artifacts retain product-name, infrastructure, and canary
  findings. Source-path exceptions do not cover bundle-relative asset paths.
  Rebuild only after owned source corrections, then separately review remaining
  product-name matches; do not allowlist a whole minified asset or hash filename.
- Old deployment/configuration/service scripts contain operator usernames, home
  paths, domain/subdomain references, account handles, and IPs. Historical
  evidence includes blobs `026126902e4e`, `07a561aac2d4`, `0bd6ceb75d09`,
  `2e9fdf3ea150`, `93bb60739493`, `cd427a1c04bb`, and `ee664b0922f4`.
  Actual values are deliberately omitted. A historical agent-name match beside
  an operator home path is not equivalent to a public harness catalog entry.
- Historical licence references, compression dictionaries, ignore entries, and
  numeric fixtures need contextual classification, not blanket deletion. Current
  allowlists are intentionally not applied to historical blobs by this scanner.

## Verification and limits

Run from the repository root, directing evidence to a private scratch directory:

```sh
python3 scripts/public-hygiene-gate.py --repo-root . \
  --panel-dist-dir apps/panel/dist --evidence-dir "$PRIVATE_EVIDENCE_DIR"
python3 -m unittest discover -s tests -p test_public_hygiene_gate.py
```

The gate scans working and indexed candidate contents, non-ignored untracked
files, current filenames, HEAD-reachable commit metadata/messages, historical
changed paths/blobs, and the supplied existing panel distribution. Other refs,
reflogs, ignored files, binary contents, and authenticated runtime responses are
not cleared by this run. Historical resource ceilings and errors fail closed.
A skipped runtime scan prevents full clearance even if other gates pass.
No fresh panel build or end-to-end inference certification is claimed.

Final redacted report: private scratch directory
`styx-release-hygiene-triage/20261103T064331Z/public-hygiene-report.json`.
The gate exited 1: tracked/index 600 findings (80 fatal, 520 warn), filenames
one fatal and one warn, commit metadata/messages one fatal, historical files
2,285 findings (237 fatal, 2,048 warn), existing bundle 13 fatal, runtime skipped.
The remaining tracked/index fatal paths are Tools source, its UI test, and the
connection guide. The new triage document adds no finding. All 21 scanner tests
pass after removal of the private-pattern exceptions; `git diff --check` passes.
The renamed test is byte-identical to its HEAD predecessor; no application test
or fresh panel build was performed.

## Owner decisions and detached publication proposal

1. Assign source/test example cleanup and portable documentation commands; review
   the exact-line exceptions after those edits. Stage the reviewed rename only
   when preparing the complete publication candidate.
2. Resolve upstream licence/import provenance independently. Keep mandatory
   notices and credited names; hygiene is not a relicensing mechanism.
3. Choose whether publication needs original history. If not, export only the
   reviewed candidate into a fresh directory with a new object database and
   neutral publication identity, rather than cloning private object history.
4. If lineage history is required, create an independent full local publication
   clone with no hardlinks/shared object store and no push remote. Preserve the
   original untouched. In that copy only, inventory all intended refs, map each
   operator leak to exact paths/objects, and approve targeted history sanitation.
   Preserve API/provider identifiers, public salts, licence notices, and runtime
   contracts. Do not run global brand replacements or copy private scanner data
   into the publication artifact.
5. Scan the sanitized candidate and every publication ref, rebuild in isolation,
   run tests against temporary data, review bundles, and obtain separately
   authorized runtime evidence. Record omissions. Remove backup refs and private
   objects only in the disposable copy after explicit approval; verify from a
   fresh clone before considering publication. No sanitation clone or rewrite is
   created by this triage.

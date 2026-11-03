# Publication hygiene and release blocker

The public hygiene gate is a release check, not permission to publish. Run it on the final candidate and production-mode panel build, with operator-private patterns available and an authorized isolated runtime. A skipped runtime or private catalog is incomplete; HTTP authentication denials fail runtime coverage. The scan checks the working tree and staged index, rejects shallow history, and covers only commits reachable from HEAD, not other refs or reflogs; binary content and the gate's own fixtures are excluded. Review the generated redacted report and perform any additional secret scanning appropriate to the release.

## Historical findings

A local HEAD scan found fatal historical matches in these categories (the report identifies blobs and lines without reproducing matched text):

- Operator identifiers, host paths, network and deployment details in earlier operational scripts and configuration. Treat these as private disclosures, not harmless matches. Determine exposure and coordinate appropriate credential rotation if a separate review finds actual credentials; the identifier matches alone do not establish that a credential leaked.
- Upstream names in earlier README and credit records, database migrations, and a dependency lockfile. Attribution and dependency references are not secrets; preserve required upstream copyright and license notices. Some operational scripts also contain upstream references alongside private details and need separate review.
- Planning-document names in ignore rules and common words in Indonesian compression rules are contextual false positives, not evidence that private documents were published. Keep private specifications ignored.

The historical gate does not apply legacy current-file allowlists to old blobs. Explicit historical exceptions now require the full object ID, original repository-relative path, SHA-256 of the complete decoded text, exact inclusive line range, pattern identifier, and review reason. Only independently reviewed entries are installed; classifications alone do not exempt content or make the gate pass. Do not publish the existing reachable history until the owner approves an appropriate remediation. A forward-only cleanup cannot remove old objects from reachable history. Options requiring owner approval include a separately prepared clean publication repository with legally required attribution, or a coordinated history rewrite with assessment of remote copies and collaborators. Neither has been authorized here. Do not delete upstream notices to silence the scanner.

## Candidate and build

Build the panel with `bun run panel:build`; its build script sets production mode even if the caller exports a development environment. Development JSX can embed absolute source filenames in built assets. Rebuild after source changes and rescan the resulting bundle; do not publish an old bundle merely because source files pass. The gate ignores ignored untracked files, so rerun after any force-add and inspect the final index. Runtime verification must use an authorized isolated instance and must not target production without separate approval.


## Explicit operator-private review overlay

Default invocation and the legacy public allowlist remain compatible. Public-only
clones do not need private pattern identifiers in the public allowlist. Operators
may pass `--private-patterns "$PRIVATE_CATALOG" --private-allowlist "$PRIVATE_REVIEW"`
to load a trusted local Python catalog and an independently reviewed JSON overlay
outside the publication tree. No private catalog is copied into this clone.
An explicitly missing catalog/overlay, unknown pattern, malformed entry, or private
skip mode combined with an explicit catalog fails closed. Omission leaves the
existing private-catalog discovery behavior unchanged. Missing private coverage
and missing runtime coverage still prevent publication clearance.

Each new exception requires `pattern`, literal repository-relative `file`,
`surface`, lowercase `sha256`, inclusive one-based `lines`, and a nonempty `reason`.
The digest covers the complete scanned UTF-8 text (replacement-decoded if needed),
not merely a matching word. Moving or editing any content invalidates that entry.
`tracked_file` scopes to working/index contents only; `historical_file` additionally
requires `blob` with a full Git object ID, and the exact original historical path.
The same blob at another path is scanned separately. Historical paths themselves
are never exempted. `panel_bundle` additionally requires exact zero-based,
end-exclusive Unicode character `offsets` of the single regex match. This avoids
allowing an entire minified line. Runtime and filename exceptions are unsupported
by this interface. No broad private file/pattern suppression is accepted.

Reviewed public entries in `scripts/hygiene_allowlist.json` preserve upstream
credit/README/release-audit notices and public lineage in old migration comments
and workspace lockfile identifiers. Additional historical entries bind only
ignore-rule filenames, Indonesian compression-dictionary tokens and model-token
limit fixtures. Existing legacy public exceptions remain for compatibility;
none is widened by this change.

The private overlay covers independently reviewed external-agent integration
selectors, public configuration links and product display names in the Tools
page, its tests and connection guide, including their exact historical versions.
Seven production bundle matches were traced back to these same selectors/display
strings and bound to complete bundle content plus exact character offsets. It
does not suppress creator/session attribution, operator home paths, network
canaries, old filename branding, or any unrelated pattern in the reviewed text.
These must be sanitized separately, not converted into product-name exceptions.
The private overlay and machine reports remain outside the publication clone.

Build verification: `bun run panel:build` succeeded (production mode), with only
Vite's large-chunk advisory. The distribution was rebuilt, not reused. No isolated
runtime was supplied; no live runtime requests or inference claims are made.


## Latest clone verification (not clearance)

The full private-catalog and reviewed-overlay scan exited 1. The operator-pattern,
current-filename and HEAD commit-metadata/message gates passed. Current/index
content had one fatal creator-attribution marker in
`apps/panel/public/brand/PROVENANCE.txt:3`; its copied bundle provenance file had
one identical fatal marker. These are not external-agent integration references
and were deliberately not allowlisted. Their document owner must sanitize the
internal creator identifier separately while preserving the provenance facts.
Historical content/path checking retained five fatal findings: two dirty IP
canaries in old Tools blobs and three occurrences of the old branded test path
across history records. No history rewrite or path exemption was performed.
Runtime remained skipped, so even after those markers are separately remediated
this run cannot grant publication clearance. Counts include index/working and
historical occurrences, not distinct files.

The scanner regression suite ran in default and forced-public-only modes: each
ran 26 tests successfully, with one preexisting private-sibling-dependent
end-to-end fixture skipped. Explicit synthetic private-overlay, history path
isolation, content drift, schema rejection and exact bundled-match coverage tests
ran successfully. No application runtime suite or authenticated live endpoint
coverage is asserted by these scanner tests. `git diff --check` passed.

## Canonical release invocation and CI hand-off

Use the current checkout's scanner and keep the operator catalog and reviewed
overlay outside the repository. `PRIVATE_CATALOG` and `PRIVATE_REVIEW` below
are private local paths; do not copy either file into the candidate or replace
the public allowlist with either one.

```sh
python3 scripts/public-hygiene-gate.py \
  --repo-root . \
  --panel-dist-dir apps/panel/dist \
  --runtime-url "$HYGIENE_RUNTIME_URL" \
  --auth-token "$HYGIENE_RUNTIME_TOKEN" \
  --allowlist scripts/hygiene_allowlist.json \
  --private-patterns "$PRIVATE_CATALOG" \
  --private-allowlist "$PRIVATE_REVIEW"
```

`bun run panel:build` must precede this command. The exit code is authoritative:
zero requires every gate, including the authenticated isolated runtime, to pass.
Do not treat a zero-fatal static/history result with a skipped runtime as release
clearance. The workflow in `.github/workflows/publication-hygiene.yml` implements
the same contract from protected secrets; it creates the private files only in
runner scratch and fails closed when any required input is absent.

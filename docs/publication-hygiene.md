# Publication hygiene and release blocker

The public hygiene gate is a release check, not permission to publish. Run it on the final candidate and production-mode panel build, with operator-private patterns available and an authorized isolated runtime. A skipped runtime or private catalog is incomplete; HTTP authentication denials fail runtime coverage. The scan checks the working tree and staged index, rejects shallow history, and covers only commits reachable from HEAD, not other refs or reflogs; binary content and the gate's own fixtures are excluded. Review the generated redacted report and perform any additional secret scanning appropriate to the release.

## Historical findings

A local HEAD scan found fatal historical matches in these categories (the report identifies blobs and lines without reproducing matched text):

- Operator identifiers, host paths, network and deployment details in earlier operational scripts and configuration. Treat these as private disclosures, not harmless matches. Determine exposure and coordinate appropriate credential rotation if a separate review finds actual credentials; the identifier matches alone do not establish that a credential leaked.
- Upstream names in earlier README and credit records, database migrations, and a dependency lockfile. Attribution and dependency references are not secrets; preserve required upstream copyright and license notices. Some operational scripts also contain upstream references alongside private details and need separate review.
- Planning-document names in ignore rules and common words in Indonesian compression rules are contextual false positives, not evidence that private documents were published. Keep private specifications ignored.

The historical gate deliberately does not apply current-file allowlists to old blobs. These classifications are not an exemption and do not make the gate pass. Do not publish the existing reachable history until the owner approves an appropriate remediation. A forward-only cleanup cannot remove old objects from reachable history. Options requiring owner approval include a separately prepared clean publication repository with legally required attribution, or a coordinated history rewrite with assessment of remote copies and collaborators. Neither has been authorized here. Do not delete upstream notices to silence the scanner.

## Candidate and build

Build the panel with `bun run panel:build`; its build script sets production mode even if the caller exports a development environment. Development JSX can embed absolute source filenames in built assets. Rebuild after source changes and rescan the resulting bundle; do not publish an old bundle merely because source files pass. The gate ignores ignored untracked files, so rerun after any force-add and inspect the final index. Runtime verification must use an authorized isolated instance and must not target production without separate approval.

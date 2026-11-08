# Documentation

## Getting started

- [Project overview](../README.md)
- [Docker installation](../DOCKER.md)
- [Source installation](install.md)
- [Configuration and authentication](configuration.md)
- [Client and harness connections](harness-connections.md)
- [Troubleshooting and support](troubleshooting.md)

## Reference

- [Model naming, catalogs, and routing](model-naming.md)
- [Reverse proxy origin checks](reverse-proxy-origin-security.md)
- [SQLite backend safety](sqljs-file-backend-safety.md)
- [Backup and restore limitations](sqlite-restore-blocker.md)
- [Codex refresh freeze](codex-historical-refresh-freeze.md)
- [Imported credential refresh limitations](imported-refresh-claim-blocker.md)
- [Quota policy recovery](quota-policy-recovery.md)
- [Combo tag dispatch limitations](combo-tag-dispatch-consistency-blocker.md)
- [Process health data](process-health-retained-usage.md)
- [Routing trace scope](routing-trace-scope.md)

## Contributing and project policies

- [Contribution guide](../CONTRIBUTING.md)
- [Isolated probes](isolated-probes.md)
- [Security policy](../SECURITY.md)
- [Code of conduct](../CODE_OF_CONDUCT.md)
- [Credits and third-party provenance](../CREDITS.md)

## Maintainer records

These records retain historical findings, design proposals, test observations,
and deployment caveats. They are not installation instructions or evidence of
current production state. Unresolved legal and security limitations still apply;
read the relevant reference and credits before distributing or operating the server.

- [Release provenance audit](release-readiness-audit.md)
- [Publication checks](publication-hygiene.md)
- [Historical hygiene triage](publication-hygiene-triage.md)
- [Quota migration history](quota-migration-upgrade.md)
- [Quota combo reconciliation](quota-combo-cross-process-blocker.md)
- [Connection-cache migration notes](connection-cache-revision-deployment.md)
- [Offline recovery rehearsal](sqlite-offline-recovery-rehearsal.md)
- [Log URL redaction proposal](log-url-opaque-path-design-wip.md)
- [Webhook management proposal](webhook-management-design-wip.md)

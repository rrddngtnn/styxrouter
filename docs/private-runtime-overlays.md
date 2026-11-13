# Optional private prompt files in an immutable deployment

CodeBuddy CN and ZCode Start Plan already support the optional
`RATMAN_SOUL_PATH` environment variable. Its public default is empty; the
public image does not supply a personal prompt or deployment-specific path.
When configured, the existing adapters read that file. Keep the file, its
content and operational environment outside the source archive and Docker
build context.

For a replacement container, supply the existing private environment through
its private environment configuration and mount the selected file read-only.
Preserve the deployment's current effective setting rather than inventing a
public default. Docker image/Config.Env metadata alone cannot prove effective
application configuration: dotenv may populate the application process.
Inspect only presence of the selected variable in the actual running process,
then compare private file hashes in restricted evidence; never dump process
environment or prompt content. Confirm redacted transformation metadata and
separately authorized provider acceptance before claiming parity.

A generic source build does not preserve writable-layer adapter deviations,
private files, data mounts, encryption/signing configuration, accounts or
rotated credentials by itself. Image smoke and private runtime parity are
separate activation gates. Do not replace a production container until both
are verified. This document does not authorize a deployment or credential
mutation.

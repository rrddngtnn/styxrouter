# Optional private prompt files in an immutable deployment

CodeBuddy CN, ZCode Start Plan and the native ZCode (`zcode` / `zc`)
executor support the optional `RATMAN_SOUL_PATH` environment variable. Its
public default is empty; the public image does not supply a personal prompt
or deployment-specific path.
When configured, the existing adapters read that file. Keep the file, its
content and operational environment outside the source archive and Docker
build context.

## Native ZCode text contract

The native hook loads only an operator-selected absolute local regular file
(up to 256 KiB, valid UTF-8). It opens read-only and reloads each request;
unset, empty, missing or invalid files retain the original prompt. Request
bodies and credential metadata cannot select a file. Diagnostics expose only
`disabled`, `loaded` or `unavailable`, never the path or file content.

The native executor sends the optional text once as an `[Instructions]`
prefix in the existing `sendPrompt.content` string. It does **not** set a
`developer_instructions` / `developerInstructions` field or change CLI mode.
ZCode's own system instructions stay under ZCode's control. This is a prompt
prefix, not a guaranteed system/developer priority override. Caller messages
are not mutated; the existing native adapter still flattens text history and
does not acquire tool or multimodal forwarding from this hook.

The public ZCode v3.15.1 contract at commit
`aac4755666d09fdcd70272fcf063c077a639015f` declares `content: string` in
[`ZCodeAgentSendPromptParamsBase`](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/packages/services/src/zcode-agent/zcodeAgent.ts#L287)
and forwards it through
[`buildSessionSendParams`](https://github.com/zai-org/ZCode/blob/aac4755666d09fdcd70272fcf063c077a639015f/packages/services/src/zcode-agent/zcodeAgentService.ts#L785).
Neither source establishes a send-time developer-instruction field. This is
a pinned source reference, not a newly enforced runtime version pin. The
local binary fixture verifies Styx's framed stdio transmission; it does not
prove installed official CLI compatibility or upstream inference acceptance.

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

# Augment through the local Auggie CLI

`auggie` (short prefix `aug`) is an existing local CLI integration, not a
remote Augment/Cosmos API provider. Use `auggie/<exact-cli-model-id>` (or
`aug/<exact-cli-model-id>`). Display names are not wire IDs.

## Runtime prerequisites

The standard StyxRouter Dockerfile does **not** install Auggie, Node, or an
Auggie session. Registering or listing this provider therefore does not make a
stock container ready for Augment inference. Installing Auggie only on the
Docker host does not put its executable or session inside the container.

For a source installation, provision the official Auggie CLI separately for
the same unprivileged operating-system user that runs StyxRouter. Follow
[Augment's 0.x CLI documentation](https://docs.augmentcode.com/cli/v0/overview.md) for
installation, supported runtime and authentication. The general overview now
shows a 1.x prerelease; do not assume its flags/output are compatible with this
existing 0.x text adapter. Pin and review the chosen
CLI version in your own deployment; the registry's historical model inventory
was collected with Auggie 0.32.0, not a promise that this version remains
supported. No CLI package is installed or updated automatically by StyxRouter.

For a container installation, build a separately reviewed derivative image
containing the official CLI and its required runtime, or use a source
installation. Do not bake credentials or a preauthenticated session into a
redistributable image. Provision authentication privately according to the
official CLI contract for the container's runtime user; StyxRouter does not
implement CLI login, session import or a tenant bearer-token exchange.

The server resolves `AUGGIE_BIN`, then `CLI_AUGGIE_BIN`, then supported user
installation paths, then `auggie` on its own PATH (`auggie.cmd` on Windows).
Set the override in the actual server/container environment, not just your
interactive shell. If the CLI uses a runtime launcher, that runtime must also
be accessible on the server's PATH. Service/container environment and home
may differ from your login shell. No new environment variable is required.

## Onboarding and validation

There is no API key to add and no OAuth connection to create inside StyxRouter.
The no-auth route obtains synthetic local credentials (`connectionId=noauth`)
and dispatches directly to the existing CLI executor. `none` describes
**StyxRouter's credential storage**, not free or unauthenticated Augment use.
Bearer-token import is intentionally unsupported. Do not put an Augment token
into an unrelated API-key account to work around it.

The existing connection validator runs only `auggie --version`; a successful
version result proves executable availability, not login, entitlement or
inference. Missing binaries are reported as unavailable with installation and
`AUGGIE_BIN` guidance. Provider-wide blocking remains available through the
normal blocked-provider configuration; this integration is not silently
removed from registries when a machine lacks the CLI.

Before first generation the executor makes a best-effort `auggie model list`
call and extends its shipped allowlist with parsed CLI IDs. This discovery is
process-local, not per-account catalog synchronization. Static entries remain
accepted after failed discovery, so catalog listing is not proof of current
CLI/tenant model support. Restart after changing the CLI installation or
catalog when rediscovery is needed.

## Transport and limits

Requests are flattened into a text prompt and sent on stdin to
`auggie --print --quiet --model <validated-id> --`. Stdout becomes text JSON or
OpenAI-shaped SSE; CLI nonzero exits are errors. Reader cancellation now
terminates the streaming child even without an AbortSignal, and an
already-aborted request does not start a generation process.

This is a text adapter, not the native Augment SDK/API. It does not expose
caller tool definitions/tool-call round trips, images, structured native
reasoning, or a verified upstream output-token-budget contract. CLI internal
tools and its local execution permissions are governed by the operator's CLI
configuration; do not run it against a sensitive working directory or assume
that the text adapter is a sandbox. Nonstream usage is explicitly estimated,
not authoritative upstream billing usage. Discovery/validation success and
synthetic fixture tests are separate from fresh authorized inference success.

The maintained regression fixture substitutes a local executable and does not
read a real CLI session, log in, call Augment or spend inference credits.

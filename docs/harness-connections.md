# Harness connections

The **Connect tools** page generates configuration examples, not proof that a
particular model, account, or deployment works. Merge examples into existing
configuration; do not overwrite unrelated settings. Use a scoped StyxRouter API
key, never an upstream OAuth token. Snippets containing real keys are secrets:
keep them out of source control, screenshots, logs, and shared shell history.

## Endpoint conventions

Enter an HTTP(S) router root or a URL ending in `/v1`. The generator removes one
terminal `/v1` before adding protocol paths, preserving reverse-proxy prefixes.
Credentials, query strings, fragments, internal whitespace, and control characters
are rejected. Invalid intermediate input displays an error instead of crashing the
page. The opt-in connection test uses the same normalization; it sends a real,
potentially billable Chat Completions request and does not validate every protocol.

| Client | Generated contract | Official reference |
| --- | --- | --- |
| Claude Code | `ANTHROPIC_BASE_URL` is the router root; `ANTHROPIC_AUTH_TOKEN` supplies the gateway credential. Settings use an `env` object. | [Connect to a gateway](https://code.claude.com/docs/en/llm-gateway-connect), [gateway compatibility](https://code.claude.com/docs/en/llm-gateway-protocol) |
| Codex | `~/.codex/config.toml`: `model_provider`, `model_providers.styx`, `base_url` ending in `/v1`, `env_key`, `wire_api = "responses"`. | [Configuration reference](https://developers.openai.com/codex/config-reference/) |
| OpenCode | `opencode.json`: `provider.styx`, `@ai-sdk/openai-compatible`, `options.baseURL`, `models`, and a `styx/<model>` selection. | [Providers](https://opencode.ai/docs/providers/) |
| Hermes Agent | `model.provider: custom`, `model.default`, `model.base_url`, `model.key_env: STYX_API_KEY`; apply dotted settings using `hermes config set`, then launch with the exported secret. | [Providers](https://hermes-agent.nousresearch.com/docs/integrations/providers), [configuration](https://hermes-agent.nousresearch.com/docs/user-guide/configuration) |
| Factory Droid | `~/.factory/settings.json`: `customModels` entries with `model`, `displayName`, `baseUrl`, `apiKey: "${STYX_API_KEY}"`, `provider: "generic-chat-completion-api"`; export the key, run `droid`, select via `/model`. | [Custom models / BYOK](https://docs.factory.ai/cli/byok/overview) |
| Goose | `GOOSE_PROVIDER=openai`, `OPENAI_HOST` as origin, `OPENAI_BASE_PATH` as the relative prefixed `v1/chat/completions` path, `OPENAI_API_KEY`, and `GOOSE_MODEL`. This is not an OpenHands configuration. | [Providers](https://block.github.io/goose/docs/getting-started/providers/), [official documentation source](https://github.com/block/goose/blob/main/documentation/docs/getting-started/providers.md?plain=1) |
| Aider | OpenAI-compatible API base and key; model name prefixed with `openai/`. | [OpenAI-compatible APIs](https://aider.chat/docs/llms/openai-compat.html) |
| Cursor and extensions | The displayed fields are connection parameters, not a universal IDE settings-file schema. Follow each extension's provider UI. Cursor documents server-side routing, so loopback and private tailnet-only URLs are not reachable by that relay. | [Cursor API keys](https://cursor.com/help/models-and-usage/api-keys) |

Hermes paths shown as `~/.hermes/config.yaml` describe the default profile. The
command example respects the active profile / `HERMES_HOME`. Do not write settings
to another profile. The exported `STYX_API_KEY` is session-scoped; persistence, if
wanted, belongs in the active profile's `.env` or approved secrets tooling, not as
plaintext in YAML. Use `hermes config set` rather than replacing the YAML file.

Factory's older `config.json` snake_case format is a migration source, not the
current editing target. Goose's documentation repository currently redirects from
`block/goose` to `aaif-goose/goose`; its provider documentation includes the
`OPENAI_BASE_PATH` prompt and `v1/chat/completions` default.

## Network exposure is an operator decision

No tunnel is created by generating these examples. Confirm the actual listener
and launcher configuration; do not assume an environment variable changes binding.
Prefer loopback or a foreground SSH forward bound explicitly to loopback. Stop a
foreground SSH tunnel with Ctrl-C. Review public exposure separately from client
configuration: API-key authentication does not itself hide or protect admin routes.

- **Cloudflare:** [Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)
  explicitly do not support SSE. They are not a streaming-agent solution. Named
  tunnel examples require an already-created tunnel, its real UUID and credentials
  path, and DNS routing; placeholders are not runnable production configuration.
- **Tailscale:** [Serve](https://tailscale.com/docs/reference/tailscale-cli/serve)
  is private to permitted tailnet clients; [Funnel](https://tailscale.com/docs/reference/tailscale-cli/funnel)
  is public. Use the actual `*.ts.net` HTTPS URL reported by status, not an arbitrary
  custom hostname. Review HTTPS/MagicDNS/policy prerequisites and the shown off
  commands before enabling either mode.
- **Caddy:** [reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)
  documents `flush_interval -1` for low-latency streaming. Default automatic HTTPS
  needs suitable DNS and reachable validation ports. Validate before applying.
- **Nginx:** [proxy module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)
  documents `proxy_buffering off`; TLS examples still require real certificate/key
  files and renewal. Run `nginx -t` before applying a reviewed configuration.

## OAuth status evidence

A future token-expiry timestamp does **not** establish refresh-token availability,
provider support, imported-token policy, account eligibility, or a scheduled
refresh. The account row therefore shows only the expiry hint, without an
unconditional “auto-refresh” promise. Missing or invalid expiry data produces no
claim. Manual refresh remains a server-authorized operation and may fail or be
deferred; a generated client snippet says nothing about that account's refresh
capability.

## Local verification and limits

Use the repository's isolated runner (direct `bun test` is intentionally blocked):

```sh
bun apps/server/scripts/test-isolated.ts \
  "$PWD/apps/panel/tests/tools-ui.test.tsx" \
  "$PWD/apps/panel/tests/oauth-expiry-ui.test.tsx" \
  "$PWD/apps/panel/tests/provider-cards.test.tsx"
(cd apps/panel && bun run typecheck)
```

The focused checks exercise generator schemas, shell literal preservation,
URL/tunnel validation, recoverable invalid-URL rendering, and truthful rendered
expiry hints. Official references above were retrieved during this correction;
these are configuration-contract checks, not end-to-end certification. No live
inference, OAuth exchange, production database access, tunnel creation, restart,
or deployment is part of this verification. Harness-version differences and
model-specific tool/streaming support still require operator validation.

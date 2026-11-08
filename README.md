# StyxRouter

StyxRouter routes model requests through a Hono + Bun server and provides a
React administration panel for provider accounts, API keys, models, and routing.
It exposes OpenAI Chat Completions, Anthropic Messages, and OpenAI Responses
endpoints. Account rotation and protocol support depend on the provider.

- [Install with Docker](DOCKER.md)
- [Install from source](docs/install.md)
- [Configuration and authentication](docs/configuration.md)
- [Connect clients](docs/harness-connections.md)
- [Documentation index](docs/README.md)

## Quick start

The published `v0.1.1` container supports `linux/amd64`. You need Docker with
Compose for a local build, or Docker alone for the published image.

```sh
git clone https://github.com/rrddngtnn/styxrouter.git
cd styxrouter
cp docker.env.example .env
```

Edit `.env`: replace `INITIAL_PASSWORD` with a long unique password and set
`JWT_SECRET`, `API_KEY_SECRET`, and `STORAGE_ENCRYPTION_KEY` to separate values.
Generate each secret with `openssl rand -hex 32`. Keep the file private.

```sh
docker run -d --name styxrouter \
  --restart unless-stopped \
  -p 127.0.0.1:20128:20128 \
  --env-file .env \
  -v styx-data:/data \
  ghcr.io/rrddngtnn/styxrouter:v0.1.1
curl --fail http://127.0.0.1:20128/api/health
```

Open <http://127.0.0.1:20128/panel/> and sign in with `INITIAL_PASSWORD`.
Add a provider account, select a configured model, and use **Test model** to
check it. That action uses your panel session and may incur upstream charges;
it does not require a router API key.

Create a scoped key in the panel's API keys page for external clients. Public
`/v1` inference requires `Authorization: Bearer <router-api-key>`; the panel
password and upstream OAuth tokens are not client API keys. The **Connect tools**
page generates client settings. Its **Test connection** action uses an API key,
unlike **Test model**. See [client setup](docs/harness-connections.md).

## Providers and models

Integrations include Codex, Antigravity, Kiro, CodeBuddy CN and Intl, Z.ai GLM,
OpenAI, Anthropic, Gemini, and OpenAI-compatible nodes. The panel lists registered
providers and their available authentication methods. This is not a guarantee
that every upstream account or model is available.

Use the exact model ID from your configured catalog, usually `provider/model-id`.
Listing a model does not prove that an account can serve it. See
[model naming and routing](docs/model-naming.md) for catalog synchronization,
effort variants, eligibility, and context metadata.

| Endpoint | Protocol |
| --- | --- |
| `GET /v1/models` | Configured model catalog |
| `POST /v1/chat/completions` | OpenAI Chat Completions |
| `POST /v1/messages` | Anthropic Messages |
| `POST /v1/responses` | OpenAI Responses |

## Deployment and data safety

The native server listens on `0.0.0.0:20128` by default. Docker examples publish
it only on loopback. Source installations need firewall or network isolation;
the server does not honor a `HOST` setting to change that binding.

For remote access, use a TLS reverse proxy, restrict backend access, and set
`STYX_TRUSTED_PUBLIC_ORIGIN` to the exact public HTTPS origin. This is required
for panel model tests behind a TLS-terminating proxy. See
[origin checks](docs/reverse-proxy-origin-security.md).

Persistent storage requires a synchronous SQLite driver. Bun supplies
`bun:sqlite`; file-backed sql.js is disabled. Backups can be created and listed,
but there is no supported safe restore command. Do not replace a live database
or remove its WAL/SHM files. Read [storage safety](docs/sqljs-file-backend-safety.md)
and [restore limitations](docs/sqlite-restore-blocker.md).

Credential encryption can fall back to plaintext when the key is missing or
encryption fails. Back up the encryption key separately and read the
[security policy](SECURITY.md) before storing provider credentials.

## Development

The workspace contains `apps/server` (Hono + Bun), `apps/panel` (React + Vite),
and root `scripts` for isolated probes, image verification, and publication checks.
Use Bun 1.4.3 and the committed `bun.lock`.

```sh
bun install --frozen-lockfile
bun run panel:build
bun run server:test
bun run server:test:py
bun run panel:test
bun run panel:typecheck
```

Run server tests through the isolated runner, not bare `bun test`. See
[CONTRIBUTING.md](CONTRIBUTING.md) for development setup, focused tests, browser
fixtures, and contribution requirements.

## Support

Start with [troubleshooting](docs/troubleshooting.md). For bugs and usage questions,
[open an issue](https://github.com/rrddngtnn/styxrouter/issues) with the image tag
or commit, installation method, and redacted reproduction. Do not include keys,
OAuth tokens, cookies, databases, or unredacted configuration. Follow
[SECURITY.md](SECURITY.md) for sensitive reports and the
[code of conduct](CODE_OF_CONDUCT.md) when participating.

## Credits & lineage

StyxRouter derives from [OmniRoute](https://github.com/diegosouzapw/OmniRoute)
and includes attributed ports from [9Router](https://github.com/decolua/9router)
and other projects. The Z.ai integration uses client identity and plan taxonomy
from [ZCode](https://zcode.z.ai).

## License

The root [LICENSE](LICENSE) records an MIT grant, but the retained tree is not
verified as MIT-only. The former Hailuo executor contained a GPL-3.0-source port
from gpt4free; it is excluded from the current tree, not retained Git history.
[CREDITS.md](CREDITS.md) preserves notices, pinned evidence, and unresolved
provenance questions. These records do not relicense the project or establish
legal clearance. npm publication remains disabled; use Docker or a source checkout.

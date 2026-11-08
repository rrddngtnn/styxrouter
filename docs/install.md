# Install from source

[Documentation](README.md) · [Docker installation](../DOCKER.md)

## Requirements

- Git and Bun 1.4.3, the version used by the Dockerfile and CI.
- A writable local data directory with reliable SQLite locking.
- OpenSSL to generate secrets. Python 3 is needed for tooling tests.

Run commands from the repository root unless noted otherwise.

```sh
git clone https://github.com/rrddngtnn/styxrouter.git
cd styxrouter
bun install --frozen-lockfile
bun run panel:build
cp docker.env.example apps/server/.env
chmod 600 apps/server/.env
```

Edit `apps/server/.env` before starting. Replace the sample password and set
three independent secrets using `openssl rand -hex 32` for each. Set `DATA_DIR`
to an absolute path dedicated to this installation. See
[configuration](configuration.md) for key handling and storage limitations.

```sh
bun run server:start
```

The script changes into `apps/server`, where Bun loads `.env`, and starts
`server/styx.ts`. It serves the built panel at
<http://127.0.0.1:20128/panel/> and health at
<http://127.0.0.1:20128/api/health>.

The listener binds `0.0.0.0`, not loopback. Restrict access with a firewall or
container network before starting on a reachable host. `HOST` does not change
the native entrypoint's binding. Set `PORT` if the default `20128` is occupied.
For remote use, read [reverse proxy configuration](reverse-proxy-origin-security.md).

## First connection

1. Sign in to the panel with the bootstrap password.
2. Add a provider account using the authentication method shown for that provider.
3. Choose a configured model and run **Test model**. This uses the panel session
   without an API key and can incur provider charges.
4. Create a scoped router API key for your client.
5. Use **Connect tools** or the [client guide](harness-connections.md).

The bootstrap password is stored as a hash. Changing `INITIAL_PASSWORD` after
that does not overwrite the saved password; change it through the panel.

## Development and updates

Follow [CONTRIBUTING.md](../CONTRIBUTING.md) for tests and the panel fixture server.
Use disposable data and credentials for development. Rebuild the panel after UI
changes. Before updating an existing installation, review migrations and create
a backup; there is no supported safe restore command or automatic schema rollback.
Do not share a SQLite database across hosts or unreliable network filesystems.

npm publication is disabled. The repository's package metadata and CLI do not
mean that a supported npm installation is available.

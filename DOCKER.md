# Running with Docker

[Documentation](docs/README.md) · [Configuration](docs/configuration.md)

## Published image

`ghcr.io/rrddngtnn/styxrouter:v0.1.1` is published for `linux/amd64`.
There is no published ARM64 image for this release. `latest` follows main;
use a version tag or digest when you need a fixed deployment.

From a [source checkout](docs/install.md), prepare the environment:

```sh
cp docker.env.example .env
chmod 600 .env
```

Edit all four values before starting. Use a unique `INITIAL_PASSWORD` and generate
separate values for each secret with `openssl rand -hex 32`. Do not commit `.env`.

```sh
docker pull ghcr.io/rrddngtnn/styxrouter:v0.1.1
docker run -d --name styxrouter \
  --restart unless-stopped \
  -p 127.0.0.1:20128:20128 \
  --env-file .env \
  -v styx-data:/data \
  ghcr.io/rrddngtnn/styxrouter:v0.1.1
docker logs styxrouter
curl --fail http://127.0.0.1:20128/api/health
```

Open <http://127.0.0.1:20128/panel/> and sign in with `INITIAL_PASSWORD`.
The container listens on port `20128`; this mapping exposes it only on loopback.
Changing only the host side of the mapping does not change the container port.
Keep the internal default unless you also update `PORT` and the mapping.

## Build locally with Compose

Docker Compose builds the current checkout, not the published release image:

```sh
docker compose up -d --build
docker compose logs -f styx
```

The service is `styx`, its local image is `styxrouter:local`, and its environment
comes from the root `.env`. The Dockerfile uses Bun 1.4.3, builds the panel, and
runs as the `bun` user. Local builds on other architectures are not release-tested
artifacts. The published workflow builds and smoke-tests only `linux/amd64`.

## Persistence and updates

The container uses `DATA_DIR=/data`. The named `styx-data` volume stores the
database and `db_backups`. Scheduled backups default to a 24-hour interval,
keeping seven scheduled copies; the panel also supports manual backups.
Back up `STORAGE_ENCRYPTION_KEY` separately: encrypted credentials require the
original key. See [backup settings](docs/configuration.md#backups).

There is no supported safe restore command. Do not replace the database or its
sidecars based on a service-stop check. Read the
[restore limitations](docs/sqlite-restore-blocker.md) before planning recovery.

Before updating, review release notes and pending database migrations, preserve
your secrets, and create a backup. Stop and remove the old container before
creating its replacement with the same volume and environment. Removing a
container does not remove this named volume. `docker compose down` also keeps
it; `docker compose down -v` deletes Compose-managed volumes and their data.
An application rollback does not reverse database migrations.

## Remote access

Place a TLS reverse proxy in front of the loopback mapping. Set
`STYX_TRUSTED_PUBLIC_ORIGIN` to your canonical HTTPS origin and restrict backend
access. See [reverse proxy origin checks](docs/reverse-proxy-origin-security.md)
and [client networking](docs/harness-connections.md#network-exposure).

Cloudflare Workers cannot run this server: it needs writable SQLite storage and
Bun APIs. A tunnel is a separate deployment choice; Cloudflare Quick Tunnels do
not support SSE. See [troubleshooting](docs/troubleshooting.md) for startup,
authentication, and streaming failures.

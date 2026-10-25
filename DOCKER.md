# Running with Docker

```sh
cp docker.env.example .env      # then fill in the four values (openssl rand -hex 32)
docker compose up -d --build
docker compose logs -f styx     # wait for "StyxRouter :20128"
```

Open `http://127.0.0.1:20128/panel/` and sign in with `INITIAL_PASSWORD`. The database and backups live in the
`styx-data` volume (`/data`); a scheduled backup runs daily and the panel has a **Back up now** button.

- The container listens on port 20128 and is published on the loopback interface only. Put a reverse proxy with TLS
  in front of it if you need remote access.
- Back up the volume **and** `STORAGE_ENCRYPTION_KEY` together: credentials in a backup cannot be read without the key.
- Images are built for whatever architecture you build on (the base images exist for amd64 and arm64).
- `docker compose down` keeps your data; `docker compose down -v` deletes it.

Not supported: Cloudflare Workers. The router needs a writable SQLite file, long-lived streaming connections and
Node/Bun APIs that the Workers runtime does not provide. To expose it through Cloudflare, run it as above and use a
Cloudflare Tunnel in front.

#!/bin/bash
# Publication example only: review reverse-proxy configuration before applying.
set -euo pipefail
cat <<'INSTRUCTIONS'
Use docs/caddy.styxrouter.conf as a template, not a live deployment claim.
Replace styx.example.com with a hostname you control and point DNS to your
server's actual public address (192.0.2.20 is documentation-only).
Match reverse_proxy to the reviewed server PORT (example: 20128).
Back up /etc/caddy/Caddyfile, merge the reviewed block without overwriting
unrelated sites, then validate:
  sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
Only after successful validation, reload Caddy and check your own HTTPS health
endpoint. Review authentication, admin-route exposure and firewall policy first.
This instruction-only script does not edit files or reload services.
INSTRUCTIONS
exit 1

#!/bin/bash
# Publication example only: no automatic process termination or system changes.
set -euo pipefail
cat <<'INSTRUCTIONS'
Review docs/styxrouter.service before installation:
1. Create a dedicated styx account and install the checkout at /home/styx/styxrouter.
2. Install Bun at /home/styx/.bun/bin/bun (or edit ExecStart and PATH in the unit).
3. Provision apps/server/.env for the styx account, mode 0600; set private storage
   configuration explicitly. Preserve existing encryption keys for existing data.
4. The example unit explicitly sets PORT=20128; match any reverse proxy to it.
5. Stop only the specific existing StyxRouter instance under your control.
6. Back up any existing unit, then as administrator copy the reviewed unit to
   /etc/systemd/system/styxrouter.service, run systemctl daemon-reload and
   systemctl enable --now styxrouter.service.
7. Check systemctl status styxrouter.service and the local health endpoint:
   curl --fail http://127.0.0.1:20128/api/health
No services are stopped, users created, files installed or permissions changed
by this instruction-only script. Review bind address and firewall policy first.
INSTRUCTIONS
exit 1

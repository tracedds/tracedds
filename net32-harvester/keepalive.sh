#!/usr/bin/env bash
# Restart the harvester if it isn't answering /health. Cron-friendly:
#   */5 * * * * $HOME/net32-harvester/keepalive.sh
PORT="${NET32_HARVESTER_PORT:-8791}"
here="$(dirname "$(readlink -f "$0")")"
curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1 || exec "$here/start.sh"

#!/usr/bin/env bash
# Start the Net32 harvester under a virtual display (xvfb), detached so it
# survives the launching shell. Idempotent: exits 0 if it's already healthy.
# Used by cron (@reboot) and keepalive.sh. Binds 0.0.0.0 by default so the
# Airflow container can reach it over the Docker host gateway — keep a token set.
set -uo pipefail
cd "$(dirname "$(readlink -f "$0")")"

PORT="${NET32_HARVESTER_PORT:-8791}"
LOG="${NET32_HARVESTER_LOG:-/tmp/net32-harvester.log}"

# Load optional local config (NET32_HARVESTER_TOKEN, overrides, ...).
[ -f .env ] && { set -a; . ./.env; set +a; }

if curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
  echo "[net32-harvester] already healthy on :${PORT}"
  exit 0
fi

export NET32_HARVESTER_HOST="${NET32_HARVESTER_HOST:-0.0.0.0}"
export NET32_HARVESTER_PORT="$PORT"
# Persistent profile so the cleared cf_clearance cookie survives restarts.
export NET32_PROFILE_DIR="${NET32_PROFILE_DIR:-$HOME/.net32-profile}"
mkdir -p "$NET32_PROFILE_DIR"

echo "[net32-harvester] starting on ${NET32_HARVESTER_HOST}:${PORT} ($(date -u +%FT%TZ))" >>"$LOG"
setsid bash -c "exec xvfb-run -a node server.mjs" >>"$LOG" 2>&1 < /dev/null &
disown 2>/dev/null || true
echo "[net32-harvester] launched (log: $LOG)"

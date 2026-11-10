#!/bin/zsh
# What launchd runs: the production server, with my secrets from a 0600 file outside the repo.
set -euo pipefail

JARVIS_DIR="${0:A:h:h}"
DATA_DIR="${JARVIS_DATA_DIR:-$HOME/.jarvis}"

# The node that ran `npm ci` in install.sh: better-sqlite3 is built for that exact version.
if [[ ! -f "$DATA_DIR/runtime" ]]; then
  echo "Missing $DATA_DIR/runtime: run ops/install.sh first." >&2
  exit 1
fi
source "$DATA_DIR/runtime"

# launchd starts with a bare PATH: gh and the system tools the Mac collector calls.
export PATH="${JARVIS_NODE:h}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

# JARVIS_TAILNET_HOST, JARVIS_TAILSCALE_LOGIN and CLAUDE_CODE_OAUTH_TOKEN live here, never in the plist or the repo.
if [[ -f "$DATA_DIR/env" ]]; then
  set -a
  source "$DATA_DIR/env"
  set +a
fi

cd "$JARVIS_DIR"
export NODE_ENV=production
# exec, and node itself: no npm or shell left running next to the server.
exec "$JARVIS_NODE" --import tsx server/src/index.ts

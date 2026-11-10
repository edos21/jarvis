#!/bin/zsh
# Builds Jarvis and (re)loads it as a LaunchAgent: it starts at login and restarts if it dies.
set -euo pipefail

JARVIS_DIR="${0:A:h:h}"
DATA_DIR="${JARVIS_DATA_DIR:-$HOME/.jarvis}"
LABEL="com.edos.jarvis"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

NODE_PATH_NOW="$(command -v node || true)"
if [[ -z "$NODE_PATH_NOW" ]]; then
  echo 'node is not on PATH: run "nvm use" in the repo first.' >&2
  exit 1
fi

cd "$JARVIS_DIR"
npm ci
npm run build

# The database holds full account numbers: the directory is mine only.
mkdir -p "$DATA_DIR/logs"
chmod 700 "$DATA_DIR"
# run.sh uses this same node, so the native modules npm ci just built always match.
print -r -- "JARVIS_NODE=${(q)NODE_PATH_NOW}" > "$DATA_DIR/runtime"
if [[ ! -f "$DATA_DIR/env" ]]; then
  umask 077
  cat > "$DATA_DIR/env" <<ENV
# Read by ops/run.sh. Keep this file 0600.
# JARVIS_TAILNET_HOST=your-mac.your-tailnet.ts.net
# JARVIS_TAILSCALE_LOGIN=you@example.com
# CLAUDE_CODE_OAUTH_TOKEN=
ENV
  echo "Created $DATA_DIR/env: add CLAUDE_CODE_OAUTH_TOKEN (claude setup-token) and JARVIS_TAILNET_HOST there."
fi
chmod 600 "$DATA_DIR/env"

sed -e "s|__JARVIS_DIR__|$JARVIS_DIR|g" -e "s|__DATA_DIR__|$DATA_DIR|g" ops/$LABEL.plist > "$PLIST"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
# bootout returns before launchd lets go of the service; bootstrapping too soon fails with an I/O error.
for _ in {1..20}; do
  launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || break
  sleep 0.5
done
if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
  echo "launchd still holds $LABEL after 10 s; run ./ops/uninstall.sh, then install again." >&2
  exit 1
fi
launchctl bootstrap "gui/$(id -u)" "$PLIST"

echo "Jarvis is starting on http://127.0.0.1:4417 (logs: $DATA_DIR/logs/jarvis.log)."
echo "To reach it from your phone, run once: tailscale serve --bg --https=443 http://127.0.0.1:4417"

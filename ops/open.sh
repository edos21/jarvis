#!/bin/zsh
# What the Jarvis app on my Desktop runs: opens the panel, starting the launchd service first if it is not answering.
set -uo pipefail

URL="http://127.0.0.1:4417"
LABEL="com.edos.jarvis"
DOMAIN="gui/$(id -u)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

up() { curl -fsS -m 2 "$URL/api/health" >/dev/null 2>&1 }

if ! up; then
  launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1 || launchctl bootstrap "$DOMAIN" "$PLIST"
  launchctl kickstart -k "$DOMAIN/$LABEL"
  for _ in {1..30}; do
    up && break
    sleep 1
  done
fi

if up; then
  open "$URL"
else
  osascript -e 'display alert "Jarvis no arrancó" message "Revisa ~/.jarvis/logs/jarvis.log, o corre ./ops/install.sh en ~/dev/edos/jarvis."'
  exit 1
fi

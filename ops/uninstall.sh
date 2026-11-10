#!/bin/zsh
# Stops Jarvis and removes its LaunchAgent. Data in ~/.jarvis stays.
set -euo pipefail

LABEL="com.edos.jarvis"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
echo "Jarvis stopped. To stop publishing it on the tailnet: tailscale serve --https=443 off"

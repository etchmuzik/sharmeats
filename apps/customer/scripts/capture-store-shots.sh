#!/usr/bin/env bash
#
# Snapshot helper for CLEAN in-app App Store screenshots (Apple Guideline 2.3.3).
#
# This is a thin wrapper around `xcrun simctl io screenshot`. NAVIGATION is done
# by the capturing agent driving the real UI (tap/scroll), NOT by this script —
# because the tracking screen needs an order that only exists after checkout,
# and item modals need a live menu-item tap. Driving the UI yields genuine
# "app in actual use" states, which is exactly what 2.3.3 requires.
#
# The agent calls `shot <name>` after navigating to each screen.
#
# Usage:
#   source ./scripts/capture-store-shots.sh <SIMULATOR_UDID> <OUT_DIR>
#   shot 01-home
#   ... navigate ...
#   shot 02-restaurant
#
# Or one-off:
#   ./scripts/capture-store-shots.sh <UDID> <OUT_DIR> <name>

UDID="${1:?need simulator UDID}"
OUT="${2:?need output dir}"
RAW="$OUT/raw"
mkdir -p "$RAW"

shot() {  # shot <name>
  local name="${1:?need shot name}"
  xcrun simctl io "$UDID" screenshot --type=png "$RAW/$name.png"
  printf "  captured %s\n" "$name.png"
}

# If a third arg is given, capture once and exit (non-sourced use).
if [ "${3:-}" != "" ]; then
  shot "$3"
fi

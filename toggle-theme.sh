#!/bin/bash
# Toggle between 'simple' and 'powerline' statusline themes.
DIR="$(cd "$(dirname "$0")" && pwd)"
FILE="$DIR/.statusline-theme"
CURRENT=$(cat "$FILE" 2>/dev/null || echo "simple")

if [ "$CURRENT" = "simple" ]; then
  echo "powerline" > "$FILE"
  echo "Switched to powerline theme"
else
  echo "simple" > "$FILE"
  echo "Switched to simple theme"
fi

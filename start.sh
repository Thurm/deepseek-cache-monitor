#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
PIDFILE="$DIR/proxy.pid"
LOG="$DIR/logs/proxy-$(date +%Y-%m-%d).log"
mkdir -p "$DIR/logs"

# Clean logs older than 3 days
find "$DIR/logs" -name 'proxy-*.log' -mtime +3 -delete 2>/dev/null

if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "Proxy already running (PID $(cat "$PIDFILE"))"
  exit 0
fi

nohup node "$DIR/proxy.mjs" >> "$LOG" 2>&1 &
echo $! > "$PIDFILE"
echo "Proxy started (PID $!)"
echo "Logs: $LOG"

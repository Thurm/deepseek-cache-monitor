#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$DIR/proxy.pid"
LOG="$DIR/logs/proxy-$(date +%Y-%m-%d).log"
mkdir -p "$DIR/logs"

# Clean logs older than 3 days
find "$DIR/logs" -name 'proxy-*.log' -mtime +3 -delete 2>/dev/null

# Only kill the proxy process by its saved PID — never lsof the port
if [ -f "$PID_FILE" ]; then
  OLD_PID=$(cat "$PID_FILE")
  if kill -0 "$OLD_PID" 2>/dev/null; then
    kill "$OLD_PID"
    for i in $(seq 1 30); do
      kill -0 "$OLD_PID" 2>/dev/null || break
      sleep 0.1
    done
  fi
  rm -f "$PID_FILE"
fi

# Start new proxy (nohup so it survives shell exit)
cd "$DIR" && mkdir -p logs && nohup node proxy.mjs >> "$LOG" 2>&1 &
echo "proxy restarted (pid: $!)"
echo "Logs: $LOG"

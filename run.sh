#!/data/data/com.termux/files/usr/bin/bash
# Arranca/parar o ARGUS em background de forma fiável no Termux.
# Uso: ./run.sh start | stop | restart | status | reset
set -u
DIR="$(cd "$(dirname "$0")" && pwd)/apps/server"
LOG="/data/data/com.termux/files/usr/tmp/opencode/logs/argus.log"
PIDF="/data/data/com.termux/files/usr/tmp/opencode/logs/argus.pid"
mkdir -p "$(dirname "$LOG")"
cd "$DIR"

stop() {
  if [ -f "$PIDF" ]; then
    kill "$(cat "$PIDF")" 2>/dev/null
    rm -f "$PIDF"
  fi
  pkill -f 'src/inde[x].ts' 2>/dev/null
  sleep 1
}

start() {
  setsid --fork env PORT="${PORT:-8787}" node src/index.ts > "$LOG" 2>&1 < /dev/null
  sleep 3
  pgrep -f 'src/inde[x].ts' | head -1 > "$PIDF" 2>/dev/null || true
  status
}

status() {
  if curl -s --max-time 4 "http://127.0.0.1:${PORT:-8787}/api/health" >/dev/null 2>&1; then
    curl -s --max-time 4 "http://127.0.0.1:${PORT:-8787}/api/health"; echo
  else
    echo "fora do ar"; tail -5 "$LOG" 2>/dev/null
  fi
}

case "${1:-start}" in
  start)   start ;;
  stop)    stop; echo "parado" ;;
  restart) stop; start ;;
  reset)   stop; rm -f "$DIR/data/argus.db" "$DIR/data/argus.db-wal" "$DIR/data/argus.db-shm"; start ;;
  status)  status ;;
  log) tail -40 "$LOG" ;;
  *) echo "uso: $0 start|stop|restart|status|reset|log"; exit 1 ;;
esac

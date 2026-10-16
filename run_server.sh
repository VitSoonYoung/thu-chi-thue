#!/bin/bash
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
binary="$project_dir/bin/thuchithue"
config_file="$project_dir/config.local.json"
port=3210
stop=false
background=false

usage() {
  cat <<'EOF'
Usage: ./run_server.sh [--port PORT] [--hup] [--kill] [--config FILE]

Runs the built server silently in the foreground by default.
  --port PORT  Select a port (default 3210).
  --hup        Run in the background and survive terminal closure.
  --kill       Stop the app on the selected port and exit.
  --config FILE  Access configuration (default config.local.json).
  --help       Show this help.
Combine --kill and --hup to restart in the background.
Build the app first with npm run release.
EOF
}

while (($#)); do
  case "$1" in
    --kill) stop=true; shift ;;
    --hup) background=true; shift ;;
    --port)
      if (($# < 2)); then
        printf '%s\n' 'Missing port value.' >&2
        exit 1
      fi
      port="$2"
      shift 2
      ;;
    --config)
      if (($# < 2)); then printf '%s\n' 'Missing config path.' >&2; exit 1; fi
      config_file="$2"
      shift 2
      ;;
    --help) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 1 ;;
  esac
done

if [[ ! "$port" =~ ^[0-9]{1,5}$ ]]; then
  printf '%s\n' 'Port must be an integer from 1 to 65535.' >&2
  exit 1
fi
port=$((10#$port))
if ((port < 1 || port > 65535)); then
  printf '%s\n' 'Port must be an integer from 1 to 65535.' >&2
  exit 1
fi

command -v lsof >/dev/null || { printf '%s\n' 'lsof is required.' >&2; exit 1; }
pids="$(lsof -nP -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
if [[ -n "$pids" ]]; then
  if ! "$stop"; then
    printf 'Port %s is already in use. Use --kill to stop the app first.\n' "$port" >&2
    exit 1
  fi
  for pid in $pids; do
    if ! lsof -a -p "$pid" -d txt -Fn 2>/dev/null | grep -Fxq "n$binary"; then
      printf 'Refusing to stop another application on port %s.\n' "$port" >&2
      exit 1
    fi
  done
  for pid in $pids; do
    kill -TERM "$pid"
  done
  for ((attempt=0; attempt<60; attempt++)); do
    remaining=false
    for pid in $pids; do
      if kill -0 "$pid" 2>/dev/null; then remaining=true; fi
    done
    if ! "$remaining"; then break; fi
    sleep 0.2
  done
  if "$remaining"; then
    printf '%s\n' 'Server is still shutting down. Try again shortly.' >&2
    exit 1
  fi
fi

if "$stop" && ! "$background"; then exit 0; fi
if [[ ! -x "$binary" ]]; then
  printf '%s\n' 'Server binary missing. Run npm run release first.' >&2
  exit 1
fi

if ! "$background"; then
  exec "$binary" --config "$config_file" --port "$port" --headless=true --quiet=true
fi

mkdir -p "$project_dir/.tmp"
log_file="$project_dir/.tmp/server.$port.log"
set -m
nohup "$binary" --config "$config_file" --port "$port" --headless=true --quiet=true >"$log_file" 2>&1 </dev/null &
server_pid=$!
disown "$server_pid"
for ((attempt=0; attempt<50; attempt++)); do
  if ! kill -0 "$server_pid" 2>/dev/null; then
    cat "$log_file" >&2
    exit 1
  fi
  if lsof -a -p "$server_pid" -iTCP:"$port" -sTCP:LISTEN -t >/dev/null 2>&1; then
    exit 0
  fi
  sleep 0.1
done
printf 'Server startup could not be confirmed. Check %s\n' "$log_file" >&2
exit 1

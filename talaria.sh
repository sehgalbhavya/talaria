#!/usr/bin/env bash
# Talaria launcher for Mac and Linux. Same steps as Talaria.bat.
set -euo pipefail
cd "$(dirname "$0")"
URL="http://127.0.0.1:${TALARIA_PORT:-5178}"

open_url() {
  if command -v open >/dev/null 2>&1; then open "$1"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$1" >/dev/null 2>&1
  else echo "  Open $1 in your browser."
  fi
}

# Already running? Just open it.
if curl -fsS --max-time 2 "$URL/api/bootstrap" >/dev/null 2>&1; then
  echo "Talaria is already running - opening it."
  open_url "$URL"
  exit 0
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js isn't installed. Get the LTS version from https://nodejs.org, then run this again."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing dependencies, one moment..."
  npm install --no-audit --no-fund
fi

echo "Building the app..."
npx vite build --logLevel warn

# Open the browser only once the server is actually answering (up to 90s).
(
  for _ in $(seq 1 90); do
    if curl -fsS --max-time 2 "$URL/api/bootstrap" >/dev/null 2>&1; then open_url "$URL"; break; fi
    sleep 1
  done
) &

echo
echo "  Starting Talaria at $URL - your browser opens as soon as it's ready."
echo "  Keep this window open while you use it. Press Ctrl+C to stop."
echo
exec npx tsx server/index.ts

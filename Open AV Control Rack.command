#!/bin/zsh
set -e

cd "$(dirname "$0")"

PORT="${PORT:-4173}"
URL="http://127.0.0.1:${PORT}"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install Node.js 18 or newer, then run this again."
  read -r "?Press Return to close..."
  exit 1
fi

echo "AV Control Rack"
echo "Serving: ${URL}"
echo "Press Control-C in this window to stop the local preview."
echo

open "${URL}" >/dev/null 2>&1 || true
PORT="${PORT}" npm start

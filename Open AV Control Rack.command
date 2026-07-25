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

PORT="${PORT}" node server.js &
server_pid=$!

cleanup() {
  kill "${server_pid}" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

for _ in {1..50}; do
  if curl --silent --fail "${URL}" >/dev/null 2>&1; then
    open "${URL}" >/dev/null 2>&1 || true
    wait "${server_pid}"
    exit $?
  fi
  if ! kill -0 "${server_pid}" >/dev/null 2>&1; then
    wait "${server_pid}"
    exit $?
  fi
  sleep 0.1
done

echo "The local preview did not become ready at ${URL}."
exit 1

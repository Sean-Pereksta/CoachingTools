#!/bin/sh
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not available. You can still open index.html directly."
  exit 1
fi
exec node "$SCRIPT_DIR/build/start-local-server.js"

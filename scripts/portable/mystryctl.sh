#!/usr/bin/env sh
set -eu

if [ -z "${MYSTRY_HOME:-}" ]; then
  MYSTRY_HOME=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
fi
export MYSTRY_HOME
: "${MYSTRY_CONFIG_PATH:=$MYSTRY_HOME/config/panel.env}"
: "${MYSTRY_DATA_DIR:=$MYSTRY_HOME/data}"
export MYSTRY_CONFIG_PATH MYSTRY_DATA_DIR

exec "$MYSTRY_HOME/runtime/bin/node" \
  --experimental-sqlite \
  "$MYSTRY_HOME/app/mystryctl.mjs" \
  "$@"

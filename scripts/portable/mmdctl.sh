#!/usr/bin/env sh
set -eu

MMD_HOME=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
export MMD_HOME
: "${MMD_CONFIG_PATH:=$MMD_HOME/config/panel.env}"
: "${MMD_DATA_DIR:=$MMD_HOME/data}"
export MMD_CONFIG_PATH MMD_DATA_DIR

exec "$MMD_HOME/runtime/bin/node" \
  --experimental-sqlite \
  "$MMD_HOME/app/mmdctl.mjs" \
  "$@"

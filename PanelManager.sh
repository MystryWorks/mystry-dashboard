#!/usr/bin/env bash
# Linux / WSL 源码管理入口：依赖与构建完成后交给 mystryctl 处理安全生命周期。
set -euo pipefail

PROJECT_ROOT="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
CONTROLLER="$PROJECT_ROOT/scripts/portable/mystryctl.mjs"

fail() {
  printf '错误：%s\n' "$*" >&2
  exit 1
}

if [ "$(uname -s)" != 'Linux' ]; then
  fail 'PanelManager.sh 仅支持 Linux / WSL；Windows 请使用 PanelManager.cmd。'
fi

# WSL 可能继承 Windows 临时目录；优先使用具有 Unix 权限语义的 /tmp。
if [ -z "${TMPDIR:-}" ] || [[ "$TMPDIR" == /mnt/* ]]; then
  export TMPDIR=/tmp
fi

if ! command -v node >/dev/null 2>&1; then
  fail '未找到 Node.js。请先安装 Node.js 22 或更高版本。'
fi

if ! node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)"; then
  fail '无法读取 Node.js 版本。'
fi
case "$node_major" in
  ''|*[!0-9]*) fail "无法识别 Node.js 主版本：$node_major" ;;
esac
if [ "$node_major" -lt 22 ]; then
  fail "Node.js 版本过低：$(node --version)。本项目要求 22 或更高版本。"
fi

if [ ! -f "$CONTROLLER" ]; then
  fail "找不到生命周期控制器：$CONTROLLER"
fi

if [ "$#" -gt 1 ]; then
  fail '每次只能指定一个命令；可用命令：start、foreground、stop、restart、logs、rebuild、status、open、help。'
fi

ensure_dependencies() {
  if ! command -v npm >/dev/null 2>&1; then
    fail '未找到 npm。请修复 Node.js 22 或更高版本的安装。'
  fi

  if [ ! -d "$PROJECT_ROOT/node_modules" ] \
    || [ ! -f "$PROJECT_ROOT/node_modules/.package-lock.json" ] \
    || [ "$PROJECT_ROOT/package-lock.json" -nt "$PROJECT_ROOT/node_modules/.package-lock.json" ]; then
    printf '正在根据 package-lock.json 安装依赖…\n'
    (
      cd "$PROJECT_ROOT"
      npm ci
    )
  fi
}

build_sources() {
  printf '正在构建 shared、server 和 web…\n'
  (
    cd "$PROJECT_ROOT"
    npm run build
  )
}

run_controller() {
  cd "$PROJECT_ROOT"
  exec node --experimental-sqlite "$CONTROLLER" "$@"
}

command="${1:-start}"
case "$command" in
  start|foreground)
    ensure_dependencies
    build_sources
    run_controller "$command"
    ;;
  rebuild)
    ensure_dependencies
    build_sources
    run_controller restart
    ;;
  stop|restart|logs|status|open|help|-h|--help)
    run_controller "$command"
    ;;
  *)
    fail "未知命令：$command。可用命令：start、foreground、stop、restart、logs、rebuild、status、open、help。"
    ;;
esac

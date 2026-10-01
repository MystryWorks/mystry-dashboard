#!/usr/bin/env bash
# Cloud Agent 环境安装脚本：幂等，可重复执行。
# 负责安装依赖、构建共享类型包，并在缺失时生成开发用 .env。
set -euo pipefail

# 切换到仓库根目录（本脚本位于 <root>/.cursor/ 下）
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[install] 安装 npm 依赖 (npm ci)"
if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi

echo "[install] 构建共享类型包 @mmd/shared"
npm run build -w @mmd/shared

# 生成开发用 .env（仅当缺失时）。密钥为本机随机生成，不会提交到仓库。
if [ ! -f .env ]; then
  echo "[install] 未检测到 .env，基于 .env.example 生成开发配置"
  JWT_SECRET_VALUE="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")"
  SETUP_TOKEN_VALUE="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")"
  sed \
    -e "s|^JWT_SECRET=.*|JWT_SECRET=${JWT_SECRET_VALUE}|" \
    -e "s|^SETUP_TOKEN=.*|SETUP_TOKEN=${SETUP_TOKEN_VALUE}|" \
    .env.example > .env
  echo "[install] 已生成 .env（JWT_SECRET / SETUP_TOKEN 为随机值）"
else
  echo "[install] 已存在 .env，跳过生成"
fi

echo "[install] 完成"

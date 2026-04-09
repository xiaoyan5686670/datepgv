#!/usr/bin/env bash
# 生成源码安装包（不依赖 Docker、不含图数据库 POC 目录）。
# 在仓库根目录执行：bash scripts/make-install-package.sh

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

STAMP="$(date +%Y%m%d-%H%M%S)"
ARCHIVE_NAME="datepgv-install-${STAMP}.tar.gz"
# 输出到仓库上级，避免 tar 把自身打进包内
ARCHIVE_PATH="$(dirname "$ROOT")/${ARCHIVE_NAME}"

echo "Packaging source bundle from: $ROOT"
echo "Output: $ARCHIVE_PATH"

tar -czvf "$ARCHIVE_PATH" \
  --exclude='.git' \
  --exclude='.idea' \
  --exclude='.env' \
  --exclude='frontend/node_modules' \
  --exclude='frontend/.next' \
  --exclude='backend/__pycache__' \
  --exclude='backend/**/__pycache__' \
  --exclude='*.pyc' \
  --exclude='.venv' \
  --exclude='venv' \
  --exclude='graph-poc' \
  --exclude='docker-compose.yml' \
  --exclude='docker-compose.ubuntu.yml' \
  --exclude='backend/Dockerfile' \
  --exclude='frontend/Dockerfile' \
  --exclude='frontend/Dockerfile.dev' \
  -C "$ROOT" \
  .

echo ""
echo "完成：${ARCHIVE_PATH}"
echo "将压缩包拷贝到目标机器后解压，按包内 docs/INSTALL_FROM_PACKAGE.md 操作。"

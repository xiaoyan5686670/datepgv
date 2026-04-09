#!/usr/bin/env bash
# 在仓库根目录执行：bash scripts/package-for-ubuntu.sh
# 生成 datepgv-ubuntu-YYYYMMDD-HHMMSS.tar.gz，用于拷贝到 Ubuntu 22.04 解压部署。

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

STAMP="$(date +%Y%m%d-%H%M%S)"
ARCHIVE_NAME="datepgv-ubuntu-${STAMP}.tar.gz"
ARCHIVE_PATH="${ROOT}/${ARCHIVE_NAME}"

echo "Packaging from: $ROOT"
echo "Output: $ARCHIVE_PATH"

# 排除开发产物、密钥与大数据目录，减小体积
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
  --exclude='graph-poc/pg_age_data' \
  --exclude='graph-poc/neo4j' \
  --exclude='graph-poc/memgraph' \
  -C "$ROOT" \
  .

echo ""
echo "Done. Upload to server, then:"
echo "  scp $ARCHIVE_NAME user@server:/opt/"
echo "  See docs/DEPLOY_UBUNTU22.md"

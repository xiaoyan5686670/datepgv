#!/usr/bin/env bash
# 本地开发一键启动：同时启动后端（uvicorn）与前端（npm run dev）。
# 使用前请先按 docs/LOCAL_DEV.md 安装并启动 PostgreSQL、执行 init-db/01-init.sql。

set -e
cd "$(dirname "$0")/.."
ROOT="$PWD"

if [ ! -f "$ROOT/.env" ]; then
  echo "未找到 .env，已从 .env.example 复制，请编辑 .env 后重新运行本脚本。"
  cp "$ROOT/.env.example" "$ROOT/.env"
  exit 1
fi
# 后端从 backend/ 目录启动时会读取 backend/.env，同步根目录 .env
cp "$ROOT/.env" "$ROOT/backend/.env" 2>/dev/null || true

echo "正在启动后端与前端（需先确保 PostgreSQL 已按 LOCAL_DEV.md 配置并已执行 init-db）..."
echo "后端: http://localhost:8000/docs  前端: http://localhost:3000"
echo "按 Ctrl+C 可同时结束两个进程。"
echo ""

# 启动后端（子 shell）
(
  cd "$ROOT/backend"
  exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
) &
BACKEND_PID=$!

# 启动前端（子 shell）
(
  cd "$ROOT/frontend"
  exec npm run dev
) &
FRONTEND_PID=$!

cleanup() {
  kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
  exit 0
}
trap cleanup SIGINT SIGTERM

wait

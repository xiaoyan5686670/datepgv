/** @type {import('next').NextConfig} */
/**
 * API 经 App Router：`src/app/api/backend/[...path]/route.ts` 转发到 FastAPI（支持 SSE 流式）。
 * Docker 在前端容器上设置 BACKEND_URL=http://backend:8000；本机默认 http://127.0.0.1:8000。
 */
const nextConfig = {
  output: "standalone",
};

module.exports = nextConfig;

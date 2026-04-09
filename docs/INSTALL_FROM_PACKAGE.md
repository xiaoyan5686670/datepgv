# 从安装包部署（无 Docker、无图数据库）

本说明对应由 `scripts/make-install-package.sh` 生成的 **`datepgv-install-*.tar.gz`**。

- 压缩包默认生成在**仓库目录的上一级**（与仓库并列），避免打包时把压缩包自身打进去。
- 包内仅含前后端源码与 `init-db/` 等脚本，**不含** Docker 文件、`graph-poc`。
- **不**说明如何安装 PostgreSQL：请自备数据库，就绪后在 `.env` 中配置 `DATABASE_URL` 并执行 `init-db/` 下 SQL（步骤略，见根目录 `README.md`）。

## 环境要求

- Python **3.11+**
- Node.js **20**（LTS）与 npm
- 自备 **PostgreSQL**（需启用 **pgvector**，并执行仓库内 `init-db/` 下 SQL；具体建库步骤略）

## 解压

```bash
mkdir -p /opt/datepgv && tar -xzf datepgv-install-*.tar.gz -C /opt/datepgv
cd /opt/datepgv
```

## 配置

```bash
cp .env.example .env
# 编辑 .env：至少设置 DATABASE_URL（指向你的 PostgreSQL）、LLM/Embed 相关变量等，参见仓库根目录 README.md
```

## 后端（FastAPI）

```bash
cd /opt/datepgv/backend
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## 前端（Next.js）

新开终端：

```bash
cd /opt/datepgv/frontend
npm ci
npm run build
npm run start
```

默认前端 `http://localhost:3000`，API 文档 `http://localhost:8000/docs`。前端通过 Next 路由把 `/api/backend` 转发到本机 **8000** 端口（与 README 中说明一致）。

## 国内 npm / pip 加速（可选）

- pip：`pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple`
- npm：`npm config set registry https://registry.npmmirror.com` 后再 `npm ci`

## 生产建议（概要）

- 使用 systemd 或 supervisor 托管上述两条进程。
- 配置 HTTPS 反向代理（如 Nginx）仅对外暴露 443。
- 勿将 `.env` 提交到版本库；生产务必设置强随机 `JWT_SECRET_KEY` 等，见主 README 与 `docs/DEPLOY_AND_AUTH_MIGRATION.md`。

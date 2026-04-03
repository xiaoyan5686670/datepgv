# 安装指南（INSTALL）

## 1. 环境准备

- **系统要求**
  - Linux / macOS / WSL2
  - 推荐内存 ≥ 8 GB
- **依赖**
  - Docker + docker compose（推荐一键启动）
  - 或：
    - Node.js ≥ 18（用于 Next.js 前端）
    - Python ≥ 3.10（用于 FastAPI 后端）
    - 本机 PostgreSQL ≥ 14（如不使用 Docker）

## 2. 获取代码

```bash
git clone https://github.com/your-org/datepgv.git
cd datepgv
```

## 3. 配置环境变量

复制示例环境变量文件：

```bash
cp .env.example .env
```

打开 `.env`，根据你使用的 LLM 服务商进行配置。

### 3.1 使用 OpenAI（示例）

```env
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-xxx

EMBEDDING_PROVIDER=openai
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIM=1536
```

### 3.2 使用 Google Gemini（推荐）

```env
LLM_PROVIDER=gemini
GEMINI_API_KEY=AIza-xxx
GEMINI_MODEL=gemini-2.0-flash

EMBEDDING_PROVIDER=gemini
EMBEDDING_MODEL=text-embedding-004
EMBEDDING_DIM=768
```

> **注意**：如果修改了 `EMBEDDING_DIM`，需要同步修改 `init-db/01-init.sql` 中 `vector(1536)` 的维度，并重建数据库。

### 3.3 使用 DeepSeek

```env
LLM_PROVIDER=deepseek
LLM_MODEL=deepseek-coder
DEEPSEEK_API_KEY=sk-xxx
```

### 3.4 使用本地 Ollama

```env
LLM_PROVIDER=ollama
OLLAMA_MODEL=qwen2.5-coder:32b
OLLAMA_API_BASE=http://host.docker.internal:11434

EMBEDDING_PROVIDER=ollama
EMBEDDING_MODEL=nomic-embed-text
EMBEDDING_DIM=768
```

## 4. 使用 Docker 一键启动

这是推荐方式，会同时启动：

- PostgreSQL（带 pgvector 扩展）
- FastAPI 后端服务
- Next.js 前端

在项目根目录执行：

```bash
docker compose up -d
```

启动完成后：

- 前端 Chatbot：<http://localhost:3000>
- 后端 API 文档：<http://localhost:8000/docs>
- PostgreSQL：`localhost:5432`（默认用户、密码、库名见 `docker-compose.yml` / `init-db`）

## 5. 初始化数据库 / 示例数据

PostgreSQL 会在容器首次启动时自动执行 `init-db` 目录下的 SQL：

- `01-init.sql`：创建元数据表、chat 历史表、llm 配置表等
- `02-...`：表关系 / graph 边
- `03-...`：MySQL NL 回答等（视版本）
- `05-analytics_db_settings.sql`：「设置 → 数据连接」用的分析库 URL 存储表（旧库可单独执行此文件补齐）
- `06-table_metadata_db_type_mysql_oracle.sql`：放宽 `table_metadata.db_type` 校验，允许 `mysql` / `oracle`（仅跑过早期 `01-init` 的旧库需执行）

如需在本机 PostgreSQL 中手动初始化，可参考：

```bash
psql -h localhost -U datepgv -d datepgv -f init-db/01-init.sql
```

## 6. 本地开发（不使用 Docker）

### 6.1 启动 PostgreSQL（容器或本机）

使用容器启动仅数据库：

```bash
docker compose up postgres -d
```

或使用本机已有 PostgreSQL，确保：

- 已安装 `pgvector` 扩展
- 已执行 `init-db/01-init.sql`

### 6.2 启动后端（FastAPI）

```bash
cd backend
pip install -r requirements.txt

# 确保 .env 中 DATABASE_URL 指向本机 PostgreSQL，例如：
# DATABASE_URL=postgresql+asyncpg://datepgv:datepgv123@localhost:5432/datepgv

uvicorn app.main:app --reload
```

后端默认监听：<http://localhost:8000>

### 6.3 启动前端（Next.js）

```bash
cd frontend
npm install
npm run dev
```

前端默认运行在：<http://localhost:3000>

## 7. 常见安装问题

- **端口被占用**
  - 调整 `docker-compose.yml` 中的端口映射，或关闭占用端口的进程。
- **无法连接 PostgreSQL**
  - 检查数据库容器是否启动成功。
  - 检查 `.env` 中的 `DATABASE_URL` 与实际连接信息是否一致。
- **LLM 调用失败**
  - 确认 API key 正确且未过期。
  - 如果使用代理 / 自建网关，检查 `*_API_BASE` 是否正确。


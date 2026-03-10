# NL-to-SQL RAG System

基于 RAG（检索增强生成）的自然语言转 SQL 系统，支持生成 Hive SQL 和 PostgreSQL。

## 架构

```
用户 → Next.js Chatbot → FastAPI → RAG引擎(pgvector检索) → LiteLLM → OpenAI/DeepSeek/Ollama
                                                           ↑
                                              PostgreSQL + pgvector (表元数据库)
```

## 快速开始

### 1. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，填入你的 LLM API Key
```

最小配置（使用 OpenAI）：
```env
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
EMBEDDING_PROVIDER=openai
EMBEDDING_MODEL=text-embedding-3-small
```

使用 Google Gemini（推荐）：
```env
LLM_PROVIDER=gemini
GEMINI_API_KEY=AIza...
GEMINI_MODEL=gemini-2.0-flash      # 或 gemini-1.5-pro

# 如需同时用 Gemini 做 Embedding（需改向量维度为 768）：
EMBEDDING_PROVIDER=gemini
EMBEDDING_MODEL=text-embedding-004
EMBEDDING_DIM=768
```
> ⚠️ 使用 Gemini Embedding 时，需同步修改 `init-db/01-init.sql` 中的 `vector(1536)` → `vector(768)`，并重建数据库（`docker compose down -v && docker compose up -d`）。

使用 DeepSeek：
```env
LLM_PROVIDER=deepseek
LLM_MODEL=deepseek-coder
DEEPSEEK_API_KEY=sk-...
```

使用本地 Ollama：
```env
LLM_PROVIDER=ollama
OLLAMA_MODEL=qwen2.5-coder:32b
OLLAMA_API_BASE=http://host.docker.internal:11434
EMBEDDING_PROVIDER=ollama
EMBEDDING_MODEL=nomic-embed-text
EMBEDDING_DIM=768
```

> ⚠️ 若更改 `EMBEDDING_DIM`，需同步修改 `init-db/01-init.sql` 中 `vector(1536)` 的维度并重建数据库。

### 2. 启动服务

```bash
docker compose up -d
```

服务地址：
- 前端 Chatbot: http://localhost:3000
- 后端 API 文档: http://localhost:8000/docs
- PostgreSQL: localhost:5432

### 3. 导入表元数据

访问 http://localhost:3000/admin，支持：
- **手动录入**: 填写表单
- **DDL 解析**: 粘贴 CREATE TABLE 语句
- **CSV 批量导入**: 上传 CSV/Excel（格式见下方）
- **数据库自动同步**: 通过 API `/api/v1/metadata/sync/postgresql`

CSV 格式示例：
```csv
table_name,column_name,column_type,table_comment,column_comment,nullable,is_partition_key,tags
ods_orders,order_id,STRING,订单表,订单ID,false,false,"ods,orders"
ods_orders,amount,DECIMAL,订单表,金额,false,false,
```

### 4. 开始对话

访问 http://localhost:3000，选择 SQL 类型（Hive / PostgreSQL），输入自然语言查询。

## 本地开发（不使用 Docker）

```bash
# 启动 PostgreSQL（仅 DB）
docker compose up postgres -d

# 后端
cd backend
pip install -r requirements.txt
cp ../.env.example .env  # 配置 DATABASE_URL=postgresql+asyncpg://datepgv:datepgv123@localhost:5432/datepgv
uvicorn app.main:app --reload

# 前端
cd frontend
npm install
npm run dev
```

## API 文档

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/v1/chat/stream | SSE 流式对话 |
| GET  | /api/v1/metadata/ | 列出所有表元数据 |
| POST | /api/v1/metadata/ | 新增表元数据 |
| PUT  | /api/v1/metadata/{id} | 更新表元数据 |
| DELETE | /api/v1/metadata/{id} | 删除 |
| POST | /api/v1/metadata/import/ddl | DDL 解析导入 |
| POST | /api/v1/metadata/import/csv | CSV 批量导入 |
| POST | /api/v1/metadata/sync/postgresql | 自动同步 PG 库 |
| POST | /api/v1/metadata/search | 语义搜索表 |
| POST | /api/v1/metadata/reembed | 重新生成所有向量 |

## 项目结构

```
datepgv/
├── backend/              # FastAPI 后端
│   └── app/
│       ├── api/          # 路由（chat, metadata）
│       ├── core/         # 配置、数据库
│       ├── models/       # SQLAlchemy 模型 + Pydantic Schema
│       └── services/     # embedding, rag, llm, sql_generator, ddl_parser
├── frontend/             # Next.js 14 前端
│   └── src/
│       ├── app/          # 页面（主页 + /admin）
│       ├── components/   # ChatBox, SQLResult, MetadataForm, DDLImportModal
│       ├── lib/          # API 客户端, 工具函数
│       └── types/        # TypeScript 类型定义
├── init-db/              # PostgreSQL 初始化 SQL（pgvector + 建表 + 示例数据）
├── docker-compose.yml
└── .env.example
```

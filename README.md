# NL-to-SQL RAG System

基于 RAG（检索增强生成）的自然语言转 SQL 系统，支持生成 Hive SQL 和 PostgreSQL。

## 架构

```
用户 → Next.js Chatbot → FastAPI → RAG引擎(向量检索) → LiteLLM → OpenAI/Gemini/DeepSeek/...
                                                       ↑
                                          PostgreSQL + pgvector（表元数据与向量）
```

## 快速开始

### 1. 配置环境变量

```bash
cp .env.example .env
```

在 `.env` 中只需保证 **DATABASE_URL**、**NEXT_PUBLIC_API_URL** 正确。**大模型与 Embedding 均在应用内「设置」页配置**（见下方「启动服务」后访问 http://localhost:3000/settings），无需在 .env 中填写 API Key；若需用环境变量覆盖，可设置对应 `*_API_KEY`。

### 2. 启动服务

**方式 A（Docker）**

```bash
docker compose up -d
```

**方式 B（本地无 Docker）**

完整步骤见 **[docs/LOCAL_DEV.md](docs/LOCAL_DEV.md)**。完成后可运行 `./scripts/dev-local.sh` 同时启动后端与前端（需先按 LOCAL_DEV 安装 PostgreSQL 并执行 init-db）。

**服务地址**

- 前端 Chatbot: http://localhost:3000
- 设置页（配置 LLM / Embedding）: http://localhost:3000/settings
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

无 Docker 的完整本地开发（本机 PostgreSQL + pgvector、Python、Node 直接运行）请参见 **[docs/LOCAL_DEV.md](docs/LOCAL_DEV.md)**；可选 `./scripts/dev-local.sh` 启动后端+前端。使用 Docker 时：`docker compose up -d` 启动后端与前端（数据库需在宿主机自行安装并运行）。

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

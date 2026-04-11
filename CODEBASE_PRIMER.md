# CODEBASE_PRIMER.md
**项目核心信息 & AI 编码规则（Cursor / Claude / GPT 必须严格遵守）**

## 1. 项目基本信息
- **框架**：FastAPI (Python 3.11+)
- **主要技术栈**：
  - Web 框架：FastAPI（异步优先）
  - ORM：SQLAlchemy 2.0（必须使用 AsyncSession）
  - 数据库驱动：asyncpg + PostgreSQL
  - 向量数据库：pgvector 扩展
  - LLM 调用层：**LiteLLM**（统一抽象层，支持 OpenAI、Gemini、Ollama、阿里云百炼等）
  - SQL 处理：**sqlglot**（用于动态 SQL 解析和安全重写）
  - 认证：JWT (python-jose) + Passlib + bcrypt
  - 数据验证：Pydantic v2 (BaseModel)
  - 异步：所有数据库、LLM、IO 操作必须使用 async/await

## 2. 项目目录结构（参考）
## 3. 关键编码规范（必须严格遵守）

### 异步要求
- 所有数据库操作必须使用 `AsyncSession`
- 依赖注入使用 `Depends(get_async_db)`
- LLM 调用统一使用 `litellm.acompletion` 和 `litellm.aembedding`
- 避免使用 `sync` 函数和 `BlockingIO`

### 权限核心原则（极其重要！）
- **层级权限规则**：
  - 上级可以查询自己及所有下级的数据（大区总 → 全大区，省总 → 全省及下级，依次类推）
  - 下级**严禁**查询上级数据
- **实现方式**：必须在 **数据库 SQL 查询层** 进行硬过滤（使用 `hierarchy_path` JSONB 数组前缀匹配）
- **禁止**：仅通过 Prompt 让 LLM 控制权限（容易被绕过）
- **推荐过滤方式**：
  ```sql
  metadata->'hierarchy_path' @> '["北部大区", "山西省", "何声洪"]'::jsonb
向量检索相关要求

表名：rag_chunks（或后续确认的表名）
关键字段：
content TEXT
embedding VECTOR(1536)（根据实际 embedding 模型维度调整）
metadata JSONB（必须包含 hierarchy_path: list[str]）

hierarchy_path 示例：["北部大区", "山西省", "何声洪", "彭小伟"]（从顶级大区开始，顺序固定）

LiteLLM 使用规范

Embedding：await litellm.aembedding(model=..., input=...)
Completion：await litellm.acompletion(model=..., messages=...)
不要直接调用 openai、gemini 等原生客户端

SQL 安全要求

动态 SQL 必须经过 sqlglot 解析和转写后再执行
优先使用参数化查询（text(sql).bindparams(...)）
避免字符串拼接 SQL

代码风格

类型提示尽可能完整（使用 from __future__ import annotations）
清晰的 docstring 和行内注释
错误处理统一使用 HTTPException
日志使用 logger（结构化日志优先）

4. 当前组织架构特点

采用大区 → 省区 → 区域/城市 → 业务经理层级结构
大区经理示例：梁永强（北部）、何书印（西部）、鹿忠麟（中部+东部）、崔露露（南部）、李运华（华中）
存在兼任情况（如鹿忠麟同时负责中部和东部）
存在专项线（部队事业部、VTE、疼痛专科线等）
hierarchy_path 必须能支持多路径或精确前缀匹配

5. 正在实现的功能
当前任务：实现支持严格层级权限的 RAG 检索系统

表：rag_chunks + 对应索引（HNSW + GIN）
服务：权限计算（UserPermission）、层级向量检索（hierarchical_vector_search）
接口：/rag/search 等 RAG 相关 endpoint
要求：权限在 SQL 层强制执行，LiteLLM 负责 embedding 和最终生成
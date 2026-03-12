"""
RAG engine – retrieves relevant table schemas via the configured vector store,
then builds a structured prompt for the LLM.
"""
from __future__ import annotations

import json
from typing import Any, Literal

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.metadata import TableMetadata
from app.services.embedding import EmbeddingService
from app.services.vector_store import get_vector_store

SQLType = Literal["hive", "postgresql"]

HIVE_RULES = """
Hive SQL 规范：
- 必须使用分区裁剪（WHERE dt = '...' 或 WHERE dt BETWEEN ...）
- 禁止不带分区条件的全表扫描
- 使用 INSERT OVERWRITE ... PARTITION(...) 写入分区表
- 日期函数使用 date_format / date_add / datediff
- 字符串拼接使用 concat()
- 不支持 LIMIT OFFSET，使用 ROW_NUMBER() OVER(...)
- JOIN 时大表放左侧，使用 /*+ MAPJOIN(small_table) */ hint 优化小表
""".strip()

POSTGRESQL_RULES = """
PostgreSQL 规范：
- 优先使用 CTE（WITH ... AS (...)）提升可读性
- NULL 处理：使用 COALESCE / NULLIF
- 日期函数：DATE_TRUNC / TO_CHAR / EXTRACT
- 使用 LIMIT / OFFSET 分页
- 窗口函数：ROW_NUMBER() / LAG() / LEAD() / SUM() OVER(...)
- 避免 SELECT *，明确列出字段
""".strip()


def _format_table_schema(row: TableMetadata) -> str:
    """Convert a TableMetadata row to a human-readable schema block."""
    full_name = ".".join(
        filter(None, [row.database_name, row.schema_name, row.table_name])
    )
    lines = [f"### 表: {full_name}  [类型: {row.db_type}]"]
    if row.table_comment:
        lines.append(f"说明: {row.table_comment}")

    cols: list[dict[str, Any]] = row.columns or []
    if cols:
        lines.append("字段:")
        for c in cols:
            nullable = "" if c.get("nullable", True) else " NOT NULL"
            partition = " [分区键]" if c.get("is_partition_key") else ""
            comment = f"  -- {c['comment']}" if c.get("comment") else ""
            lines.append(f"  {c['name']}  {c['type']}{nullable}{partition}{comment}")

    if row.sample_data:
        sample_str = json.dumps(row.sample_data[:3], ensure_ascii=False)
        lines.append(f"示例数据(前3行): {sample_str}")

    return "\n".join(lines)


class RAGEngine:
    def __init__(self, db: AsyncSession, embedding_service: EmbeddingService) -> None:
        self.db = db
        self.embedding_service = embedding_service

    async def retrieve(
        self,
        query: str,
        sql_type: SQLType,
        top_k: int | None = None,
    ) -> list[TableMetadata]:
        """
        Embed the query and perform similarity search via the configured vector store.
        Falls back to keyword search when few results are returned.
        """
        k = top_k or settings.RAG_TOP_K
        query_vec = await self.embedding_service.embed(query, self.db)
        store = get_vector_store()
        rows = await store.search(self.db, query_vec, k, sql_type)

        # If few results, supplement with unembedded rows via keyword search
        if len(rows) < k:
            rows = await self._keyword_fallback(query, sql_type, k, rows)

        return list(rows)

    async def _keyword_fallback(
        self,
        query: str,
        sql_type: str,
        k: int,
        existing: list[TableMetadata],
    ) -> list[TableMetadata]:
        existing_ids = {r.id for r in existing}
        stmt = select(TableMetadata).where(
            TableMetadata.id.not_in(existing_ids) if existing_ids else text("1=1")
        )
        if sql_type != "all":
            stmt = stmt.where(TableMetadata.db_type == sql_type)
        stmt = stmt.limit(k - len(existing))
        result = await self.db.execute(stmt)
        extras = result.scalars().all()
        return existing + list(extras)

    def build_prompt(
        self,
        query: str,
        tables: list[TableMetadata],
        sql_type: SQLType,
    ) -> list[dict[str, str]]:
        """Construct the messages list for the LLM."""
        rules = HIVE_RULES if sql_type == "hive" else POSTGRESQL_RULES
        schemas = "\n\n".join(_format_table_schema(t) for t in tables)

        system_prompt = f"""你是一个专业的数据仓库工程师，只生成 {sql_type.upper()} SQL。

{rules}

只返回 SQL 代码块（```sql ... ```），不要任何额外解释。
如果问题无法从提供的表结构中解答，返回一条注释说明原因。"""

        user_prompt = f"""可用的表结构：

{schemas}

---
用户需求：{query}

请生成 {sql_type.upper()} SQL："""

        return [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

"""
Second-pass LLM repair: map hallucinated column names to real metadata columns.
"""
from __future__ import annotations

import logging

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.metadata import TableMetadata
from app.services.llm import LLMService
from app.services.rag import _format_table_schema

logger = logging.getLogger(__name__)


async def repair_sql_unknown_columns(
    sql: str,
    unknown: list[str],
    tables: list[TableMetadata],
    join_path_lines: list[str] | None,
    sql_type: str,
    llm: LLMService,
    db: AsyncSession,
    viewer_context: str | None = None,
) -> str:
    """Ask LLM to rewrite SQL using only columns present in metadata."""
    schemas = "\n\n".join(_format_table_schema(t) for t in tables)
    jp = ""
    if join_path_lines:
        jp = "\n".join(f"- {p}" for p in join_path_lines)
    unknown_s = ", ".join(f"'{u}'" for u in unknown)

    viewer_block = ""
    if viewer_context and viewer_context.strip():
        viewer_block = (
            "\n---\n【当前登录用户与数据范围（须继续遵守，修正后 SQL 不得无故去掉相关条件）】\n"
            f"{viewer_context.strip()}\n"
        )

    system = (
        "你是 SQL 纠错助手。给定表的真实字段列表后，把 SQL 里「不在表结构中的列名」"
        "改成表中真实存在的字段名，保持业务语义与查询逻辑；JOIN 条件应与「关联路径」一致。"
        "只输出一个 ```sql ... ``` 代码块，不要解释或其他文字。"
    )
    user = f"""方言: {sql_type.upper()}

下列标识符被判定为不在元数据列清单中（可能是拼音或臆造），必须替换为下方表结构中存在的列名:
{unknown_s}

可用表结构:

{schemas}{viewer_block}
已知表之间的关联路径参考:
{jp if jp else "（无）"}

待修正 SQL:
{sql}

请输出修正后的完整可执行 SQL（仅 ```sql 代码块）："""
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    raw = await llm.chat(messages, db, temperature=0.0)
    logger.info("sql_column_repair completed for unknown=%s", unknown)
    return raw


async def repair_sql_unknown_tables(
    sql: str,
    unknown: list[str],
    tables: list[TableMetadata],
    join_path_lines: list[str] | None,
    sql_type: str,
    llm: LLMService,
    db: AsyncSession,
    viewer_context: str | None = None,
) -> str:
    """Rewrite SQL so every FROM/JOIN table reference matches a metadata-qualified name."""
    schemas = "\n\n".join(_format_table_schema(t) for t in tables)
    jp = ""
    if join_path_lines:
        jp = "\n".join(f"- {p}" for p in join_path_lines)
    unknown_s = ", ".join(f"'{u}'" for u in unknown)

    viewer_block = ""
    if viewer_context and viewer_context.strip():
        viewer_block = (
            "\n---\n【当前登录用户与数据范围（须继续遵守，修正后 SQL 不得无故去掉相关条件）】\n"
            f"{viewer_context.strip()}\n"
        )

    system = (
        "你是 SQL 纠错助手。下方「可用表结构」中每个表标题行给出了**唯一正确的完整限定表名**"
        "（含库名/模式名与完整表名，须与标题逐字一致）。"
        "把 SQL 里无法对应到这些限定名的表引用（可能是缩写、少后缀或臆造）"
        "改成标题中的完整限定名；不要新增元数据中不存在的表。"
        "只输出一个 ```sql ... ``` 代码块，不要解释或其他文字。"
    )
    user = f"""方言: {sql_type.upper()}

下列表引用无法与元数据中的限定表名对齐（须改为下方标题中的完整名）:
{unknown_s}

可用表结构（表名以「### 表:」后第一行为准）:

{schemas}{viewer_block}
已知表之间的关联路径参考:
{jp if jp else "（无）"}

待修正 SQL:
{sql}

请输出修正后的完整可执行 SQL（仅 ```sql 代码块）："""
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    raw = await llm.chat(messages, db, temperature=0.0)
    logger.info("sql_table_repair completed for unknown=%s", unknown)
    return raw


"""
Second-pass LLM repair: map hallucinated column names to real metadata columns,
and inject missing JOINs when a weak model referenced columns from a table it
forgot to include in FROM / JOIN.
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
        "你是 SQL 纠错助手。你的任务是把 SQL 中「不在表结构中的列名」纠正为「表结构中真实存在的字段名」。\n"
        "严格要求：\n"
        "- 严禁臆造、严禁拼音内联、严禁自行翻译列名。\n"
        "- 所有的列名必须从下方的「可用表结构」中挑选。\n"
        "- 如果原 SQL 使用了保留字（如 ALL, DESC 等）作为列名，必须在修正后的 SQL 中使用对应的方言引用符（如反引号 `）包裹，或替换为真实的业务字段。\n"
        "- 保持业务语义与查询逻辑一致；JOIN 条件应优先参考「关联路径」。\n"
        "- 只输出一个 ```sql ... ``` 代码块，不要提供任何解释或其他文字。"
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
        "你是 SQL 纠错助手。你的任务是修正 SQL 中「错误的表引用」。\n"
        "下方「可用表结构」中每个表标题行（### 表: ...）给出了【唯一正确】的完整限定表名。\n"
        "严格要求：\n"
        "- SQL 中的所有 FROM/JOIN 表引用必须与这些标题中的限定名（含库名/模式名）逐字一致。\n"
        "- 纠正缩写、臆造或后缀缺失的表名。\n"
        "- 不要新增元数据中不存在的表。\n"
        "- 只输出一个 ```sql ... ``` 代码块，不要提供任何解释或其他文字。"
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


async def repair_sql_missing_joins(
    sql: str,
    misplaced: list[tuple[str, list[str]]],
    tables: list[TableMetadata],
    join_path_lines: list[str] | None,
    sql_type: str,
    llm: LLMService,
    db: AsyncSession,
    viewer_context: str | None = None,
) -> str:
    """Ask LLM to add missing JOINs for columns whose owning table is absent.

    `misplaced` is a list of (column_name, [source_table_qualified_name]) pairs
    produced by find_misplaced_columns().
    """
    schemas = "\n\n".join(_format_table_schema(t) for t in tables)
    jp = ""
    if join_path_lines:
        jp = "\n".join(f"- {p}" for p in join_path_lines)

    viewer_block = ""
    if viewer_context and viewer_context.strip():
        viewer_block = (
            "\n---\n【当前登录用户与数据范围（须继续遵守，修正后 SQL 不得无故去掉相关条件）】\n"
            f"{viewer_context.strip()}\n"
        )

    # Build a human-readable list of misplaced columns and their source tables
    misplaced_lines = "\n".join(
        f"- '{col}' → 来自表: {', '.join(src_tables)}"
        for col, src_tables in misplaced
    )

    system = (
        "你是 SQL 纠错助手。你的任务是修正 SQL 中「遗漏 JOIN」的问题。\n"
        "严格要求：\n"
        "- 下方「错位列清单」中的每个列名在 SQL 中被引用，但其所属表未出现在 FROM/JOIN 中。\n"
        "- 你必须根据「已知关联路径」补充对应的 JOIN 子句，使查询合法。\n"
        "- 如果关联路径中没有直接路径，请通过中间表传递连接（多步 JOIN）。\n"
        "- 保持原有业务逻辑与过滤条件；不要删除已有的 JOIN 或 WHERE 条件。\n"
        "- 只输出一个 ```sql ... ``` 代码块，不要提供任何解释或其他文字。"
    )
    user = f"""方言: {sql_type.upper()}

错位列清单（列名已被 SQL 引用，但其宿主表未被 JOIN，须补充对应 JOIN）:
{misplaced_lines}

已知表之间的关联路径（JOIN ON 条件的权威参考）:
{jp if jp else "（无预置关联路径，请根据表结构自行推断外键关联）"}

可用表结构:

{schemas}{viewer_block}
待修正 SQL:
{sql}

请输出补全 JOIN 后的完整可执行 SQL（仅 ```sql 代码块）："""
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    raw = await llm.chat(messages, db, temperature=0.0)
    logger.info(
        "sql_missing_join_repair completed for misplaced=%s",
        [(c, s) for c, s in misplaced],
    )
    return raw


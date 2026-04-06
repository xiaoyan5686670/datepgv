"""
Ensure generated SQL only references column names present in RAG TableMetadata,
plus aliases defined in the same statement (avoids false positives on AS alias).
"""
from __future__ import annotations

import sqlglot
from sqlglot import exp

from app.models.metadata import TableMetadata
from app.services.query_executor import QueryExecutorError, assert_single_read_statement

_SQLGLOT_DIALECT = {
    "postgresql": "postgres",
    "mysql": "mysql",
    "hive": "hive",
    "oracle": "oracle",
}


def _metadata_column_whitelist(tables: list[TableMetadata]) -> set[str]:
    names: set[str] = set()
    for t in tables:
        for c in t.columns or []:
            raw = c.get("name")
            if raw and isinstance(raw, str) and raw.strip():
                names.add(raw.strip().lower())
    return names


def _table_name_whitelist(tables: list[TableMetadata]) -> set[str]:
    names: set[str] = set()
    for t in tables:
        if t.table_name and t.table_name.strip():
            names.add(t.table_name.strip().lower())
    return names


def _alias_names_in_statement(parsed: exp.Expression) -> set[str]:
    out: set[str] = set()
    for node in parsed.find_all(exp.Alias):
        al_arg = node.args.get("alias")
        if isinstance(al_arg, exp.Identifier):
            out.add(al_arg.this.lower())
        elif isinstance(al_arg, str) and al_arg.strip():
            out.add(al_arg.strip().lower())
        a = getattr(node, "alias", None)
        if isinstance(a, str) and a.strip():
            out.add(a.strip().lower())
    return out


def validate_generated_sql_columns(
    sql: str,
    tables: list[TableMetadata],
    sql_type: str,
) -> None:
    """
    Raise QueryExecutorError if the SQL references column names outside metadata
    (and not introduced as aliases in this SQL). Parsing failures are ignored
    (deferred to the database).
    """
    if not tables:
        return

    safe = assert_single_read_statement(sql)
    wl_cols = _metadata_column_whitelist(tables)
    wl_tables = _table_name_whitelist(tables)
    dialect = _SQLGLOT_DIALECT.get(sql_type, sql_type)

    try:
        parsed = sqlglot.parse_one(safe, dialect=dialect)
    except Exception:
        return

    aliases = _alias_names_in_statement(parsed)
    allowed = wl_cols | aliases | wl_tables

    unknown: list[str] = []
    seen: set[str] = set()
    for col in parsed.find_all(exp.Column):
        raw = col.name
        if raw is None:
            continue
        raw_s = str(raw).strip()
        if not raw_s or raw_s == "*":
            continue
        key = raw_s.lower()
        if key in seen:
            continue
        seen.add(key)
        if key not in allowed:
            unknown.append(raw_s)

    if unknown:
        uniq = list(dict.fromkeys(unknown))
        preview = ", ".join(f"'{u}'" for u in uniq[:12])
        more = f" 等共 {len(uniq)} 个" if len(uniq) > 12 else ""
        raise QueryExecutorError(
            "生成的 SQL 使用了元数据中不存在的列名（可能是臆造或拼音）："
            f"{preview}{more}。"
            "请仅使用「可用表结构」中列出的字段名；"
            "JOIN 请优先使用「关联路径参考」中的 ON 条件；"
            "需要展示别称时请使用「合法列名 AS 别名」。"
        )


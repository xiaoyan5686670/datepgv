"""
DDL parser – converts CREATE TABLE statements into TableMetadataCreate objects.
Uses sqlglot for broad dialect support (Hive, Spark, PostgreSQL, Oracle, etc.).
"""
from __future__ import annotations

import re
from typing import Literal

import sqlglot
import sqlglot.expressions as exp
import sqlparse

from app.models.schemas import ColumnInfo, TableMetadataCreate

SQLType = Literal["hive", "postgresql", "oracle", "mysql"]

DIALECT_MAP: dict[SQLType, str] = {
    "hive": "hive",
    "postgresql": "postgres",
    "oracle": "oracle",
    "mysql": "mysql",
}

_LEADING_COMMENTS_RE = re.compile(r"^\s*(?:--[^\n]*\n|/\*[\s\S]*?\*/\s*)*", re.IGNORECASE)
_CREATE_TABLE_RE = re.compile(
    r"^\s*create\s+(?:or\s+replace\s+)?(?:global\s+temporary\s+)?table\b",
    re.IGNORECASE,
)

# Oracle COMMENT ON: comment literal supports escaped single quotes ('').
_ORACLE_COMMENT_TABLE_RE = re.compile(
    r"""comment\s+on\s+table\s+
        (?P<full_name>[A-Z0-9_\."]+)
        \s+is\s+
        (?P<comment>'(?:[^']|'')*')
    """,
    re.IGNORECASE | re.VERBOSE,
)
_ORACLE_COMMENT_COLUMN_RE = re.compile(
    r"""comment\s+on\s+column\s+
        (?P<full_name>[A-Z0-9_\."]+)
        \s+is\s+
        (?P<comment>'(?:[^']|'')*')
    """,
    re.IGNORECASE | re.VERBOSE,
)


def _looks_like_create_table(stmt_sql: str) -> bool:
    s = _LEADING_COMMENTS_RE.sub("", stmt_sql).lstrip()
    return bool(_CREATE_TABLE_RE.match(s))


def _strip_oracle_table_options(create_table_sql: str) -> str:
    """
    Oracle exports often append physical options after the column list, e.g.
    `) TABLESPACE ... STORAGE (...)`.
    sqlglot may not support all such clauses. Strip everything after the
    closing parenthesis of the table schema.
    """
    s = _LEADING_COMMENTS_RE.sub("", create_table_sql).lstrip()
    open_idx = s.find("(")
    if open_idx == -1:
        return s
    depth = 0
    in_quote = False
    close_idx: int | None = None
    for i in range(open_idx, len(s)):
        ch = s[i]
        if ch == "'":
            in_quote = not in_quote
            continue
        if in_quote:
            continue
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                close_idx = i
                break
    if close_idx is None:
        return s
    core = s[: close_idx + 1].rstrip()
    if not core.endswith(";"):
        core += ";"
    return core


def _normalize_identifier(name: str) -> str:
    return name.replace('"', "").upper()


def _extract_oracle_comments(
    ddl: str,
) -> tuple[
    dict[tuple[str | None, str], str],
    dict[tuple[str | None, str, str], str],
]:
    """
    Extract table and column comments from Oracle COMMENT ON statements
    in the full DDL text. Supports escaped single quotes in comment literals.
    Keys: (schema, table) and (schema, table, column), normalized to uppercase.
    """
    table_comments: dict[tuple[str | None, str], str] = {}
    column_comments: dict[tuple[str | None, str, str], str] = {}

    for m in _ORACLE_COMMENT_TABLE_RE.finditer(ddl):
        full_name = m.group("full_name").strip().strip('"')
        parts = _normalize_identifier(full_name).split(".")
        if len(parts) >= 2:
            schema, table = parts[-2], parts[-1]
            schema_key: str | None = schema or None
        else:
            schema_key = None
            table = parts[-1]
        raw_comment = m.group("comment")
        text = raw_comment.strip()[1:-1].replace("''", "'")
        table_comments[(schema_key, table)] = text

    for m in _ORACLE_COMMENT_COLUMN_RE.finditer(ddl):
        full = m.group("full_name").strip().strip('"')
        parts = _normalize_identifier(full).split(".")
        if len(parts) >= 3:
            schema_key = parts[-3] or None
            table, column = parts[-2], parts[-1]
        elif len(parts) == 2:
            schema_key = None
            table, column = parts[0], parts[1]
        else:
            continue
        raw_comment = m.group("comment")
        text = raw_comment.strip()[1:-1].replace("''", "'")
        column_comments[(schema_key, table, column)] = text

    return table_comments, column_comments


def parse_ddl(
    ddl: str,
    db_type: SQLType = "hive",
    database_name: str | None = None,
) -> list[TableMetadataCreate]:
    """
    Parse one or more CREATE TABLE statements from DDL text.
    Returns a list of TableMetadataCreate objects ready for insertion.
    """
    dialect = DIALECT_MAP.get(db_type, "hive")

    oracle_table_comments: dict[tuple[str | None, str], str] = {}
    oracle_column_comments: dict[tuple[str | None, str, str], str] = {}
    if db_type == "oracle":
        oracle_table_comments, oracle_column_comments = _extract_oracle_comments(ddl)

    raw_statements = [s.strip() for s in sqlparse.split(ddl) if s.strip()]
    create_table_sqls = [
        s for s in raw_statements if _looks_like_create_table(s)
    ]

    statements: list[exp.Expression] = []
    for s in create_table_sqls:
        try:
            if db_type == "oracle":
                s = _strip_oracle_table_options(s)
            parsed = sqlglot.parse_one(s, dialect=dialect, error_level="ignore")
            if parsed is not None:
                statements.append(parsed)
        except TypeError:
            try:
                for p in sqlglot.parse(s, dialect=dialect):
                    if p is not None:
                        statements.append(p)
            except Exception:
                continue
        except Exception:
            continue

    results: list[TableMetadataCreate] = []

    for stmt in statements:
        if not isinstance(stmt, exp.Create):
            continue

        table_expr = stmt.find(exp.Table)
        if not table_expr:
            continue

        table_name = table_expr.name or ""
        schema_name = table_expr.db or None
        db_name = database_name or table_expr.catalog or None

        # Extract table comment from TBLPROPERTIES or COMMENT
        table_comment: str | None = None
        for prop in stmt.find_all(exp.SchemaCommentProperty):
            table_comment = prop.text("this")
            break
        if not table_comment:
            for prop in stmt.find_all(exp.Property):
                if prop.name and prop.name.lower() == "comment":
                    table_comment = prop.text("value").strip("'\"")
                    break

        # Extract columns
        columns: list[ColumnInfo] = []
        schema_node = stmt.find(exp.Schema)
        if schema_node:
            for col_def in schema_node.find_all(exp.ColumnDef):
                col_name = col_def.name
                col_type = col_def.kind.sql(dialect=dialect) if col_def.kind else "STRING"
                nullable = True
                col_comment = ""

                for constraint in col_def.constraints:
                    if isinstance(constraint.kind, exp.NotNullColumnConstraint):
                        nullable = False
                    if isinstance(constraint.kind, exp.CommentColumnConstraint):
                        col_comment = constraint.kind.this.name

                if db_type == "oracle":
                    key_schema = _normalize_identifier(schema_name) if schema_name else None
                    col_key = (
                        key_schema,
                        _normalize_identifier(table_name),
                        _normalize_identifier(col_name),
                    )
                    if col_key in oracle_column_comments:
                        col_comment = oracle_column_comments[col_key]

                columns.append(
                    ColumnInfo(
                        name=col_name,
                        type=col_type,
                        comment=col_comment,
                        nullable=nullable,
                        is_partition_key=False,
                    )
                )

        # Detect partition keys (Hive PARTITIONED BY)
        for part_by in stmt.find_all(exp.PartitionedByProperty):
            for part_col in part_by.find_all(exp.ColumnDef):
                part_name = part_col.name
                for col in columns:
                    if col.name == part_name:
                        col.is_partition_key = True
                if not any(c.name == part_name for c in columns):
                    columns.append(
                        ColumnInfo(
                            name=part_name,
                            type=part_col.kind.sql(dialect=dialect) if part_col.kind else "STRING",
                            comment="分区键",
                            nullable=False,
                            is_partition_key=True,
                        )
                    )

        if db_type == "oracle":
            key_schema = _normalize_identifier(schema_name) if schema_name else None
            tbl_key = (key_schema, _normalize_identifier(table_name))
            if tbl_key in oracle_table_comments:
                table_comment = oracle_table_comments[tbl_key]

        results.append(
            TableMetadataCreate(
                db_type=db_type,
                database_name=db_name,
                schema_name=schema_name or None,
                table_name=table_name,
                table_comment=table_comment,
                columns=columns,
            )
        )

    return results

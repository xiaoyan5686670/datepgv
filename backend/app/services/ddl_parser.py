"""
DDL parser – converts CREATE TABLE statements into TableMetadataCreate objects.
Uses sqlglot for broad dialect support (Hive, Spark, PostgreSQL, etc.).
"""
from __future__ import annotations

from typing import Literal

import re

import sqlglot
import sqlglot.expressions as exp

from app.models.schemas import ColumnInfo, TableMetadataCreate

SQLType = Literal["hive", "postgresql", "oracle"]

DIALECT_MAP: dict[SQLType, str] = {
    "hive": "hive",
    "postgresql": "postgres",
    "oracle": "oracle",
}


def _parse_oracle_ddl(
    ddl: str,
    database_name: str | None,
) -> list[TableMetadataCreate]:
    """
    Lightweight parser for Oracle DDL exports.

    - Extracts CREATE TABLE ... (column definitions) ...;
    - Extracts COMMENT ON COLUMN ... IS '...' statements to populate column comments;
    - Ignores indexes, storage clauses, and constraints.
    """
    lines = ddl.splitlines()

    # Collect column comments: {column_name -> comment}
    comment_map: dict[str, str] = {}
    comment_re = re.compile(
        r"comment\s+on\s+column\s+.+?\.(?P<col>[A-Za-z0-9_]+)\s+is\s+'(?P<cmt>.*)'",
        re.IGNORECASE,
    )
    for raw in lines:
        m = comment_re.search(raw.strip())
        if m:
            col = m.group("col").upper()
            cmt = m.group("cmt")
            comment_map[col] = cmt

    results: list[TableMetadataCreate] = []
    i = 0
    n = len(lines)
    while i < n:
        line = lines[i].strip()
        if line.lower().startswith("create table"):
            # Parse table name: CREATE TABLE [schema.]table (
            after_kw = line[len("create table") :].strip()
            # Handle multiline table name
            while "(" not in after_kw and i + 1 < n:
                i += 1
                after_kw += " " + lines[i].strip()
            table_name_part = after_kw.split("(", 1)[0].strip()
            full_name = table_name_part.strip('"')
            schema_name = None
            tbl_name = full_name
            if "." in full_name:
                parts = full_name.split(".")
                # Assume [schema].[table]
                schema_name = parts[-2].strip('"')
                tbl_name = parts[-1].strip('"')

            # Collect column definition block until the matching ')'
            cols_block: list[str] = []
            # If current line still has content after '(', include remainder
            if "(" in after_kw:
                remainder = after_kw.split("(", 1)[1]
                if remainder.strip():
                    cols_block.append(remainder)

            i += 1
            paren_depth = 1
            while i < n and paren_depth > 0:
                l = lines[i]
                # Track parentheses to know when CREATE TABLE column list ends
                paren_depth += l.count("(")
                paren_depth -= l.count(")")
                cols_block.append(l)
                i += 1

            # Join and split by commas at line ends to get individual column defs
            cols_text = "\n".join(cols_block)
            col_lines: list[str] = []
            buf = ""
            for raw_col in cols_text.splitlines():
                s = raw_col.strip()
                if not s:
                    continue
                buf += (" " if buf else "") + s
                if s.endswith(","):
                    col_lines.append(buf.rstrip(","))
                    buf = ""
            if buf:
                col_lines.append(buf.rstrip(","))

            columns: list[ColumnInfo] = []
            for col_def in col_lines:
                s = col_def.strip()
                # Skip table-level constraints
                if s.lower().startswith(
                    (
                        "constraint",
                        "primary key",
                        "unique",
                        "foreign key",
                        "check",
                    )
                ):
                    continue
                parts = s.split()
                if len(parts) < 2:
                    continue
                name = parts[0].strip('"')
                # Stop type at known keywords
                type_tokens: list[str] = []
                for tok in parts[1:]:
                    t_low = tok.lower()
                    if t_low in {"not", "null", "default", "constraint"}:
                        break
                    # Strip trailing commas
                    type_tokens.append(tok.rstrip(","))
                col_type = " ".join(type_tokens) if type_tokens else "VARCHAR2(100)"
                nullable = "not null" not in s.lower()
                cmt = comment_map.get(name.upper(), "")

                columns.append(
                    ColumnInfo(
                        name=name,
                        type=col_type,
                        comment=cmt,
                        nullable=nullable,
                        is_partition_key=False,
                    )
                )

            results.append(
                TableMetadataCreate(
                    db_type="oracle",
                    database_name=database_name,
                    schema_name=schema_name,
                    table_name=tbl_name,
                    table_comment=None,
                    columns=columns,
                )
            )
        else:
            i += 1

    return results


def parse_ddl(
    ddl: str,
    db_type: SQLType = "hive",
    database_name: str | None = None,
) -> list[TableMetadataCreate]:
    """
    Parse one or more CREATE TABLE statements from DDL text.
    Returns a list of TableMetadataCreate objects ready for insertion.
    """
    # Oracle: use custom lightweight parser tailored to typical export scripts.
    if db_type == "oracle":
        return _parse_oracle_ddl(ddl, database_name)

    dialect = DIALECT_MAP.get(db_type, "hive")

    # 直接忽略所有非 CREATE TABLE 语句，避免导出脚本里的
    # COMMENT ON / CREATE INDEX / ALTER TABLE ... 触发不必要的解析。
    table_stmt_texts: list[str] = []
    for raw in ddl.split(";"):
        if "create table" in raw.lower():
            table_stmt_texts.append(raw + ";")

    statements: list[exp.Expression] = []
    for stmt_text in table_stmt_texts:
        try:
            statements.extend(
                sqlglot.parse(stmt_text, dialect=dialect, error_level="ignore")
            )
        except Exception:
            # 某一条 CREATE TABLE 实在解析不了就跳过，不影响其他表
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
                # If not already in columns list, add it
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

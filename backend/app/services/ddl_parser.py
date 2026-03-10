"""
DDL parser – converts CREATE TABLE statements into TableMetadataCreate objects.
Uses sqlglot for broad dialect support (Hive, Spark, PostgreSQL, etc.).
"""
from __future__ import annotations

from typing import Literal

import sqlglot
import sqlglot.expressions as exp

from app.models.schemas import ColumnInfo, TableMetadataCreate

SQLType = Literal["hive", "postgresql"]

DIALECT_MAP: dict[SQLType, str] = {
    "hive": "hive",
    "postgresql": "postgres",
}


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
    statements = sqlglot.parse(ddl, dialect=dialect)
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

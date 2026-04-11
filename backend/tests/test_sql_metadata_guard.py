"""Tests for table/column resolution against RAG TableMetadata."""

from app.models.metadata import TableMetadata
from app.services.sql_metadata_guard import find_unknown_tables


def _meta(
    *,
    database_name: str | None = None,
    schema_name: str | None = None,
    table_name: str = "t",
) -> TableMetadata:
    return TableMetadata(
        db_type="mysql",
        database_name=database_name,
        schema_name=schema_name,
        table_name=table_name,
        columns=[{"name": "id", "type": "INT"}],
    )


def test_find_unknown_tables_rejects_truncated_mysql_table_name():
    """LLM shortens DWD_SLS_PAYMENT_ACK_STAFF -> DWD_SLS_PAYMENT: must be unknown."""
    tables = [
        _meta(
            database_name="DWD",
            table_name="DWD_SLS_PAYMENT_ACK_STAFF",
        )
    ]
    sql = "SELECT id FROM DWD.DWD_SLS_PAYMENT"
    assert find_unknown_tables(sql, tables, "mysql") == ["dwd.dwd_sls_payment"]


def test_find_unknown_tables_accepts_full_qualifier():
    tables = [
        _meta(
            database_name="DWD",
            table_name="DWD_SLS_PAYMENT_ACK_STAFF",
        )
    ]
    sql = "SELECT id FROM DWD.DWD_SLS_PAYMENT_ACK_STAFF"
    assert find_unknown_tables(sql, tables, "mysql") == []


def test_find_unknown_tables_allows_cte_reference():
    tables = [
        _meta(
            database_name="DWD",
            table_name="DWD_SLS_PAYMENT_ACK_STAFF",
        )
    ]
    sql = """
    WITH w AS (SELECT id FROM DWD.DWD_SLS_PAYMENT_ACK_STAFF)
    SELECT * FROM w
    """
    assert find_unknown_tables(sql, tables, "mysql") == []

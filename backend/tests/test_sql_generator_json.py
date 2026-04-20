"""Tests for JSON SQL envelope extraction and markdown fallback."""

from __future__ import annotations

from app.services.sql_generator import (
    SQL_OUTPUT_MODE_JSON,
    extract_natural_language_from_json,
    extract_sql_from_json,
    fix_keyword_missing_space_after,
    parse_llm_json_envelope,
    process_llm_output,
    sql_output_mode_is_json,
)


def test_sql_output_mode_is_json() -> None:
    assert sql_output_mode_is_json({"sql_output_mode": "json"}) is True
    assert sql_output_mode_is_json({"sql_output_mode": "JSON"}) is True
    assert sql_output_mode_is_json({}) is False
    assert sql_output_mode_is_json({"sql_output_mode": "markdown"}) is False


def test_parse_json_envelope_fenced() -> None:
    raw = '```json\n{"kind":"sql","sql":"SELECT 1"}\n```'
    obj = parse_llm_json_envelope(raw)
    assert obj == {"kind": "sql", "sql": "SELECT 1"}


def test_extract_sql_from_json() -> None:
    assert extract_sql_from_json('{"kind":"sql","sql":"SELECT 1"}') == "SELECT 1"
    assert extract_sql_from_json('{"kind":"text","text":"hi"}') is None


def test_extract_natural_language_from_json() -> None:
    assert extract_natural_language_from_json('{"kind":"text","text":"你好"}') == "你好"
    assert extract_natural_language_from_json('{"kind":"sql","sql":"SELECT 1"}') is None


def test_process_llm_output_markdown_default() -> None:
    raw = "```sql\nSELECT 1\n```"
    sql, nl = process_llm_output(raw, "mysql", None)
    assert nl is None
    assert sql is not None
    assert "SELECT" in sql


def test_process_llm_output_json_sql_mode() -> None:
    raw = '{"kind":"sql","sql":"SELECT 1"}'
    extra = {"sql_output_mode": SQL_OUTPUT_MODE_JSON}
    sql, nl = process_llm_output(raw, "mysql", extra)
    assert nl is None
    assert sql is not None
    assert "1" in sql


def test_process_llm_output_json_sql_without_kind_weak_model() -> None:
    raw = '{"sql":"SELECT 2"}'
    extra = {"sql_output_mode": SQL_OUTPUT_MODE_JSON}
    sql, nl = process_llm_output(raw, "mysql", extra)
    assert nl is None
    assert sql is not None
    assert "2" in sql


def test_process_llm_output_json_trailing_prose_after_brace() -> None:
    raw = '{"kind":"sql","sql":"SELECT 3"}\n\n以上。'
    extra = {"sql_output_mode": SQL_OUTPUT_MODE_JSON}
    sql, nl = process_llm_output(raw, "mysql", extra)
    assert nl is None
    assert sql is not None
    assert "3" in sql


def test_process_llm_output_json_text_mode() -> None:
    raw = '{"kind":"text","text":"仅说明，无查询"}'
    extra = {"sql_output_mode": SQL_OUTPUT_MODE_JSON}
    sql, nl = process_llm_output(raw, "mysql", extra)
    assert sql is None
    assert nl == "仅说明，无查询"


def test_process_llm_output_json_fallback_to_markdown() -> None:
    """Invalid JSON in json mode falls back to fenced SQL."""
    raw = 'not json\n```sql\nSELECT 2\n```'
    extra = {"sql_output_mode": SQL_OUTPUT_MODE_JSON}
    sql, nl = process_llm_output(raw, "mysql", extra)
    assert nl is None
    assert sql is not None
    assert "2" in sql


def test_fix_keyword_glue_select() -> None:
    fixed = fix_keyword_missing_space_after("SELECTt1.region FROM t1")
    assert "SELECT t1" in fixed or "SELECT t1.region" in fixed


def test_process_llm_output_splits_monolithic_backtick_qualified_mysql() -> None:
    raw = "```sql\nSELECT 1 FROM `DWD.DWD_SLS_PAYMENT_ACK_STAFF` AS t\n```"
    sql, nl = process_llm_output(raw, "mysql", None)
    assert nl is None
    assert sql is not None
    assert "`DWD`.`DWD_SLS_PAYMENT_ACK_STAFF`" in sql
    assert "`DWD.DWD_SLS_PAYMENT_ACK_STAFF`" not in sql


def test_process_llm_output_monolithic_backtick_json_mysql() -> None:
    raw = '{"kind":"sql","sql":"SELECT 1 FROM `a.b.c`"}'
    extra = {"sql_output_mode": SQL_OUTPUT_MODE_JSON}
    sql, nl = process_llm_output(raw, "mysql", extra)
    assert nl is None
    assert sql is not None
    assert "`a`.`b`.`c`" in sql


def test_process_llm_output_preserves_per_segment_backticks_mysql() -> None:
    raw = "```sql\nSELECT 1 FROM `DWD`.`DWD_SLS_PAYMENT_ACK_STAFF` t\n```"
    sql, _ = process_llm_output(raw, "mysql", None)
    assert sql is not None
    assert "`DWD`.`DWD_SLS_PAYMENT_ACK_STAFF`" in sql

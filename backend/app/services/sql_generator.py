"""
SQL post-processing: extract clean SQL from LLM markdown output,
and optionally validate with sqlfluff.

Optional JSON envelope (see sql_output_mode in LLM extra_params): weak models
can emit valid JSON with kind/sql or kind/text to avoid glued tokens like
SELECTt1 and stray newlines breaking Doris line-1 parse.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any


logger = logging.getLogger(__name__)

# LLM extra_params key: "markdown" (default) | "json"
SQL_OUTPUT_MODE_KEY = "sql_output_mode"
SQL_OUTPUT_MODE_JSON = "json"
SQL_OUTPUT_MODE_MARKDOWN = "markdown"


def sql_output_mode_is_json(extra_params: dict[str, Any] | None) -> bool:
    if not extra_params:
        return False
    m = str(extra_params.get(SQL_OUTPUT_MODE_KEY, SQL_OUTPUT_MODE_MARKDOWN)).lower().strip()
    return m == SQL_OUTPUT_MODE_JSON


def extract_sql(raw: str) -> str | None:
    """
    Extract SQL from a markdown code block.
    Returns None if no SQL is found and the text doesn't look like bare SQL.
    """
    # Match ```sql ... ``` or ``` ... ```
    pattern = r"```(?:sql|hive|postgresql|postgres|mysql)?\s*\n?([\s\S]*?)```"
    match = re.search(pattern, raw, re.IGNORECASE)
    if match:
        return match.group(1).strip()
    
    # No fences – check if it looks like a raw SQL statement
    text = raw.strip()
    if not text:
        return None
        
    upper_text = text.upper()
    if upper_text.startswith(("SELECT ", "WITH ", "SHOW ", "DESC ", "DESCRIBE ")):
        return text

    # It's likely just conversational text
    return None


_JSON_FENCE = re.compile(r"```(?:json)?\s*\n?([\s\S]*?)```", re.IGNORECASE)


def _candidate_json_slice(raw: str) -> str | None:
    """Text inside ```json fences, or from first ``{`` to end (decoder finds real end)."""
    raw = raw.strip()
    m = _JSON_FENCE.search(raw)
    if m:
        return m.group(1).strip()
    start = raw.find("{")
    if start < 0:
        return None
    return raw[start:].strip()


def parse_llm_json_envelope(raw: str) -> dict[str, Any] | None:
    """Parse the first JSON object from model output.

    Uses :meth:`json.JSONDecoder.raw_decode` so (1) trailing prose after ``}`` does not
    break parsing, and (2) we do not use ``first {`` … ``last }`` slicing, which breaks
    when the ``sql`` string value legitimately contains ``}`` before the real closing
    brace, or when the model adds text after valid JSON.
    """
    candidate = _candidate_json_slice(raw)
    if not candidate:
        return None
    decoder = json.JSONDecoder()
    try:
        obj, _end = decoder.raw_decode(candidate)
    except json.JSONDecodeError:
        logger.debug("parse_llm_json_envelope: JSONDecodeError on raw_decode", exc_info=False)
        return None
    if not isinstance(obj, dict):
        return None
    return obj


def extract_sql_from_json(raw: str) -> str | None:
    """If envelope has a non-empty sql field (and not kind=text), return the SQL string."""
    obj = parse_llm_json_envelope(raw)
    if not obj:
        return None
    if str(obj.get("kind", "")).lower().strip() == "text":
        return None
    sql = obj.get("sql")
    if not isinstance(sql, str) or not sql.strip():
        return None
    return sql.strip()


def extract_natural_language_from_json(raw: str) -> str | None:
    """If envelope has kind=text, return the text field for display."""
    obj = parse_llm_json_envelope(raw)
    if not obj:
        return None
    if str(obj.get("kind", "")).lower() != "text":
        return None
    text = obj.get("text")
    if not isinstance(text, str) or not text.strip():
        return None
    return text.strip()


# Weak models sometimes glue keywords to identifiers (e.g. SELECTt1.region).
# Only SELECT/FROM/WHERE: a bare GROUP prefix would false-positive on GROUPING(...).
_KEYWORD_GLUE_FIX = re.compile(
    r"(?i)(?<![A-Za-z_])(SELECT|FROM|WHERE)(?=[A-Za-z_\`\"\[])"
)


def fix_keyword_missing_space_after(sql: str) -> str:
    """Insert a space after common SQL keywords when glued to the next token."""
    if not sql:
        return sql
    prev = sql
    sql = _KEYWORD_GLUE_FIX.sub(lambda m: m.group(0) + " ", sql)
    if sql != prev:
        logger.info("fix_keyword_missing_space_after: inserted missing space after keyword")
    return sql


def validate_sql(sql: str, dialect: str = "ansi") -> list[str]:
    """
    Run sqlfluff lint on the SQL. Returns a list of violation messages.
    Gracefully returns empty list if sqlfluff is unavailable.
    """
    try:
        from sqlfluff.core import Linter

        linter = Linter(dialect=dialect)
        result = linter.lint_string(sql)
        return [v.description for v in result.violations]
    except Exception:
        return []


def format_sql(sql: str, dialect: str = "ansi") -> str:
    """
    Auto-format SQL using sqlfluff fix. Returns formatted SQL or original on error.
    """
    try:
        from sqlfluff.core import Linter

        linter = Linter(dialect=dialect)
        result = linter.fix(sql)
        return result.fixed_string or sql
    except Exception:
        return sql


DIALECT_MAP = {
    "hive": "hive",
    "postgresql": "postgres",
    "mysql": "mysql",
    "oracle": "oracle",
}

# LLM 有时会输出全角标点，分析库按 ASCII 解析会报 parse error（如 Doris 1105）。
_FULLWIDTH_SQL_PUNCT = str.maketrans(
    {
        "\uFF0C": ",",  # ， fullwidth comma
        "\uFF1B": ";",  # ； fullwidth semicolon
        "\uFF08": "(",  # （
        "\uFF09": ")",  # ）
    }
)


def normalize_sql_fullwidth_punctuation(sql: str) -> str:
    """Map common fullwidth punctuation to ASCII so engines parse SQL correctly."""
    if not sql:
        return sql
    return sql.translate(_FULLWIDTH_SQL_PUNCT)


# --------------------------------------------------------------------------- #
# Fix string-quoted numeric defaults inside IFNULL / COALESCE                   #
# --------------------------------------------------------------------------- #
# LLMs frequently generate  IFNULL(col, '0')  or  COALESCE(col, '0.0')
# The string literal causes type errors on strict engines like Doris/StarRocks
# when wrapped in SUM / AVG / COUNT etc.
# We rewrite the *default value* to an unquoted numeric literal.

_IFNULL_STRING_NUM = re.compile(
    r"\b(IFNULL|COALESCE)"
    r"\s*\("
    r"([^,]+?)"
    r",\s*'(-?\d+(?:\.\d+)?)'\s*\)",
    re.IGNORECASE,
)


def fix_ifnull_string_numerics(sql: str) -> str:
    """Rewrite  IFNULL(expr, '0')  ->  IFNULL(expr, 0)  for numeric-looking defaults.

    This prevents "sum requires a numeric parameter" errors on Apache Doris,
    StarRocks, and similar engines that enforce strict type checking.
    """
    if not sql:
        return sql
    prev = sql
    sql = _IFNULL_STRING_NUM.sub(r"\1(\2, \3)", sql)
    if sql != prev:
        logger.info("fix_ifnull_string_numerics: rewrote string-quoted numeric defaults")
    return sql


# LLMs often wrap `db.table` or `db.schema.table` in a single backtick pair. MySQL /
# Doris / StarRocks then treat that as one identifier (literal name with a dot),
# causing Unknown table 'db.table'. Split into `db`.`table` / `db`.`schema`.`tbl`.
_MONOLITHIC_BACKTICK_QUALIFIED = re.compile(
    r"`([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+)`"
)


def fix_monolithic_backtick_qualified_identifiers(sql: str, sql_type: str) -> str:
    """Rewrite `` `a.b` `` → `` `a`.`b` `` (and 3+ segments) for MySQL-family dialects."""
    if not sql or sql_type != "mysql":
        return sql

    def repl(m: re.Match[str]) -> str:
        inner = m.group(1)
        parts = inner.split(".")
        if not parts or any(not p for p in parts):
            return m.group(0)
        return ".".join(f"`{p}`" for p in parts)

    prev = sql
    sql = _MONOLITHIC_BACKTICK_QUALIFIED.sub(repl, sql)
    if sql != prev:
        logger.info(
            "fix_monolithic_backtick_qualified_identifiers: split qualified name in one backtick pair"
        )
    return sql


# --------------------------------------------------------------------------- #
# Reserved Word Heuristics                                                    #
# --------------------------------------------------------------------------- #
# Local LLMs sometimes output reserved words like 'ALL' without quotes
# even when they are intended as column names or aliases.

_UNQUOTED_ALL = re.compile(
    r"(?i)(?<=[,\s])(all)(?=[,\s])",
)


def fix_reserved_words_heuristic(sql: str, sql_type: str) -> str:
    """Wrap 'ALL' in quotes if it appears as a naked identifier.
    Very limited heuristic to avoid breaking valid 'SELECT ALL' syntax.
    """
    if not sql:
        return sql
    
    # We only touch it if it's NOT followed by '*' (SELECT ALL *)
    # and NOT part of 'UNION ALL'
    def _repl(m):
        word = m.group(1)
        start = m.start()
        # Check context
        before = sql[max(0, start-10):start].upper()
        after = sql[m.end():m.end()+10].upper()
        
        if "UNION" in before:
            return word # UNION ALL is fine
        if "SELECT" in before and "*" in after:
            return word # SELECT ALL * is fine
        
        # Otherwise, if it looks like a column in a list, wrap it
        quote = "`" if sql_type == "mysql" else '"'
        return f"{quote}{word}{quote}"

    return _UNQUOTED_ALL.sub(_repl, sql)


def _finalize_extracted_sql(sql: str, sql_type: str) -> str:
    """Normalize and format extracted SQL (markdown or JSON sql field)."""
    sql = sql.strip()
    sql = fix_keyword_missing_space_after(sql)
    sql = normalize_sql_fullwidth_punctuation(sql)
    sql = fix_ifnull_string_numerics(sql)
    sql = fix_monolithic_backtick_qualified_identifiers(sql, sql_type)
    dialect = DIALECT_MAP.get(sql_type, "ansi")
    sql = fix_reserved_words_heuristic(sql, sql_type)
    sql = format_sql(sql, dialect)
    return sql


def process_llm_output(
    raw: str,
    sql_type: str,
    extra_params: dict[str, Any] | None = None,
) -> tuple[str | None, str | None]:
    """Extract SQL from LLM output.

    Returns ``(clean_sql, natural_answer_override)``. When JSON mode emits
    ``kind: text``, the second element is the user-visible answer; otherwise
    it is None and the caller may use the raw string when ``clean_sql`` is None.
    """
    if sql_output_mode_is_json(extra_params):
        obj = parse_llm_json_envelope(raw)
        if obj is not None:
            kind = str(obj.get("kind", "")).lower().strip()
            sql_val = obj.get("sql")
            text_val = obj.get("text")

            # Explicit natural-language turn (must win over stray sql key)
            if kind == "text":
                if isinstance(text_val, str) and text_val.strip():
                    return (None, text_val.strip())
                return (None, None)

            # Weak models often omit "kind" or only send {"sql":"..."}; accept any non-empty sql string
            if isinstance(sql_val, str) and sql_val.strip():
                return (_finalize_extracted_sql(sql_val, sql_type), None)

            # {"text":"..."} without kind (some small models)
            if isinstance(text_val, str) and text_val.strip():
                return (None, text_val.strip())

            logger.info(
                "process_llm_output: JSON object has no usable sql/text; falling back to markdown fences"
            )

    sql = extract_sql(raw)
    if not sql:
        return (None, None)
    return (_finalize_extracted_sql(sql, sql_type), None)

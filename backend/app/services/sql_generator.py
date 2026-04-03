"""
SQL post-processing: extract clean SQL from LLM markdown output,
and optionally validate with sqlfluff.
"""
from __future__ import annotations

import re


def extract_sql(raw: str) -> str:
    """
    Extract SQL from a markdown code block.
    Falls back to the raw text if no fences are found.
    """
    # Match ```sql ... ``` or ``` ... ```
    pattern = r"```(?:sql|hive|postgresql|postgres|mysql)?\s*\n?([\s\S]*?)```"
    match = re.search(pattern, raw, re.IGNORECASE)
    if match:
        return match.group(1).strip()
    # No fences – return as-is, stripped
    return raw.strip()


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


def process_llm_output(raw: str, sql_type: str) -> str:
    """Full pipeline: extract SQL from LLM output and return clean SQL."""
    sql = extract_sql(raw)
    dialect = DIALECT_MAP.get(sql_type, "ansi")
    sql = format_sql(sql, dialect)
    return sql

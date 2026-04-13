"""
SQL post-processing: extract clean SQL from LLM markdown output,
and optionally validate with sqlfluff.
"""
from __future__ import annotations

import re


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


def process_llm_output(raw: str, sql_type: str) -> str | None:
    """Full pipeline: extract SQL from LLM output and return clean SQL. Returns None if it is plain text."""
    sql = extract_sql(raw)
    if not sql:
        return None
    sql = normalize_sql_fullwidth_punctuation(sql)
    dialect = DIALECT_MAP.get(sql_type, "ansi")
    sql = format_sql(sql, dialect)
    return sql

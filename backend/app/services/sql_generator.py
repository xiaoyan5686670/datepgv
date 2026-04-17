"""
SQL post-processing: extract clean SQL from LLM markdown output,
and optionally validate with sqlfluff.
"""
from __future__ import annotations

import logging
import re


logger = logging.getLogger(__name__)


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


def process_llm_output(raw: str, sql_type: str) -> str | None:
    """Full pipeline: extract SQL from LLM output and return clean SQL. Returns None if it is plain text."""
    sql = extract_sql(raw)
    if not sql:
        return None
    sql = normalize_sql_fullwidth_punctuation(sql)
    sql = fix_ifnull_string_numerics(sql)
    dialect = DIALECT_MAP.get(sql_type, "ansi")
    sql = fix_reserved_words_heuristic(sql, sql_type)
    sql = format_sql(sql, dialect)
    return sql

"""
Ensure generated SQL only references column names present in RAG TableMetadata,
plus aliases defined in the same statement (avoids false positives on AS alias).

Also validates physical table references (FROM / JOIN) against metadata-qualified
names so abbreviated or hallucinated table names (e.g. DWD_SLS_PAYMENT vs
DWD.DWD_SLS_PAYMENT_ACK_STAFF) are detected before execution.

`find_misplaced_columns` detects a subtler hallucination class where the column
name exists in metadata but belongs to a table not present in the SQL's FROM/JOIN
clauses (the model "forgot" to add the JOIN).
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


def _metadata_qualifier_parts(row: TableMetadata) -> tuple[str, ...]:
    return tuple(
        str(p).strip().lower()
        for p in (row.database_name, row.schema_name, row.table_name)
        if p is not None and str(p).strip()
    )


def _suffix_matches_meta(
    sql_parts: tuple[str, ...], meta_parts: tuple[str, ...]
) -> bool:
    if not sql_parts or not meta_parts:
        return False
    if sql_parts == meta_parts:
        return True
    if len(sql_parts) <= len(meta_parts):
        return meta_parts[-len(sql_parts) :] == sql_parts
    return False


def _sqlglot_table_qualified_parts(node: exp.Table) -> tuple[str, ...]:
    """catalog / db / table name as lowercase tuple (non-empty segments only)."""
    parts: list[str] = []
    for p in (node.catalog, node.db, node.name):
        if not p or not str(p).strip():
            continue
        parts.append(str(p).strip().lower())
    return tuple(parts)


def _cte_alias_names(parsed: exp.Expression) -> set[str]:
    names: set[str] = set()
    for cte in parsed.find_all(exp.CTE):
        alias = cte.alias
        if alias and str(alias).strip():
            names.add(str(alias).strip().lower())
    return names


def _display_table_ref(parts: tuple[str, ...]) -> str:
    return ".".join(parts)


def _matching_metadata_rows(
    sql_parts: tuple[str, ...], tables: list[TableMetadata]
) -> list[tuple[str, ...]]:
    out: list[tuple[str, ...]] = []
    for row in tables:
        meta = _metadata_qualifier_parts(row)
        if _suffix_matches_meta(sql_parts, meta):
            out.append(meta)
    return out


def find_unknown_tables(
    sql: str,
    tables: list[TableMetadata],
    sql_type: str,
) -> list[str]:
    """
    Return dotted table references in FROM / JOIN that do not resolve to any
    RAG TableMetadata row (same rules as suffix-qualified match). CTE names are
    ignored. Ambiguous bare table names (same terminal name in multiple metadata
    rows) count as unknown so the LLM must qualify them.
    """
    if not tables:
        return []

    try:
        safe = assert_single_read_statement(sql)
    except QueryExecutorError:
        return []

    dialect = _SQLGLOT_DIALECT.get(sql_type, sql_type)

    try:
        parsed = sqlglot.parse_one(safe, dialect=dialect)
    except Exception:
        return []

    cte_names = _cte_alias_names(parsed)
    unknown: list[str] = []
    seen: set[str] = set()

    for node in parsed.find_all(exp.Table):
        parts = _sqlglot_table_qualified_parts(node)
        if not parts:
            continue
        # Reference to a WITH subquery by name
        if len(parts) == 1 and parts[0] in cte_names:
            continue

        matches = _matching_metadata_rows(parts, tables)
        if not matches:
            key = _display_table_ref(parts)
            if key not in seen:
                seen.add(key)
                unknown.append(key)
            continue

        if len(parts) == 1 and len(set(matches)) > 1:
            key = _display_table_ref(parts)
            if key not in seen:
                seen.add(key)
                unknown.append(key)

    return list(dict.fromkeys(unknown))


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


def find_unknown_columns(
    sql: str,
    tables: list[TableMetadata],
    sql_type: str,
) -> list[str]:
    """
    Return column identifiers in sql that are not in metadata (nor AS aliases in sql).
    Empty list if nothing to check, SQL is not a valid single read statement, or parse fails.
    """
    if not tables:
        return []

    try:
        safe = assert_single_read_statement(sql)
    except QueryExecutorError:
        return []

    wl_cols = _metadata_column_whitelist(tables)
    wl_tables = _table_name_whitelist(tables)
    dialect = _SQLGLOT_DIALECT.get(sql_type, sql_type)

    try:
        parsed = sqlglot.parse_one(safe, dialect=dialect)
    except Exception:
        return []

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

    return list(dict.fromkeys(unknown))


def _build_col_to_tables_map(
    tables: list[TableMetadata],
) -> dict[str, list[TableMetadata]]:
    """Return {column_name_lower: [TableMetadata, ...]} across all metadata tables."""
    mapping: dict[str, list[TableMetadata]] = {}
    for t in tables:
        for c in t.columns or []:
            raw = c.get("name")
            if not raw or not isinstance(raw, str) or not raw.strip():
                continue
            key = raw.strip().lower()
            mapping.setdefault(key, []).append(t)
    return mapping


def _active_tables_from_sql(
    parsed: exp.Expression,
    tables: list[TableMetadata],
    cte_names: set[str],
) -> dict[str, TableMetadata]:
    """
    Return a mapping of {alias_lower: TableMetadata} for every physical table
    referenced in the SQL's FROM / JOIN clauses (CTE references excluded).

    When a table has no explicit alias sqlglot exposes the bare table name as the
    alias, so the dict always contains at least the table name itself.
    """
    active: dict[str, TableMetadata] = {}
    for node in parsed.find_all(exp.Table):
        parts = _sqlglot_table_qualified_parts(node)
        if not parts:
            continue
        if len(parts) == 1 and parts[0] in cte_names:
            continue

        # Find the matching metadata row (first match wins)
        meta_row: TableMetadata | None = None
        for row in tables:
            if _suffix_matches_meta(parts, _metadata_qualifier_parts(row)):
                meta_row = row
                break
        if meta_row is None:
            continue

        # Register under the SQL alias (or table name if no alias)
        alias_raw = node.alias
        alias = str(alias_raw).strip().lower() if alias_raw and str(alias_raw).strip() else None
        table_name_lower = parts[-1]

        if alias:
            active[alias] = meta_row
        active[table_name_lower] = meta_row

        # Also register by full qualified parts so qualified refs resolve
        for i in range(1, len(parts) + 1):
            key = ".".join(parts[-i:])
            active[key] = meta_row

    return active


def find_misplaced_columns(
    sql: str,
    tables: list[TableMetadata],
    sql_type: str,
) -> list[tuple[str, list[str]]]:
    """
    Detect columns that exist in metadata but whose owning table(s) are NOT
    present in the SQL's FROM / JOIN clauses.

    This catches the pattern where a weak model references table B's columns
    while only selecting FROM table A (forgetting the JOIN).

    Returns a list of (column_name, [qualified_source_table, ...]) for each
    misplaced column.  Returns [] when parsing fails or nothing is wrong.
    """
    if not tables:
        return []

    try:
        safe = assert_single_read_statement(sql)
    except QueryExecutorError:
        return []

    dialect = _SQLGLOT_DIALECT.get(sql_type, sql_type)
    try:
        parsed = sqlglot.parse_one(safe, dialect=dialect)
    except Exception:
        return []

    cte_names = _cte_alias_names(parsed)
    stmt_aliases = _alias_names_in_statement(parsed)
    active = _active_tables_from_sql(parsed, tables, cte_names)
    col_to_tables = _build_col_to_tables_map(tables)

    from app.services.rag import qualified_table_label  # local import avoids circular

    misplaced: list[tuple[str, list[str]]] = []
    seen: set[str] = set()

    for col_node in parsed.find_all(exp.Column):
        raw = col_node.name
        if raw is None:
            continue
        raw_s = str(raw).strip()
        if not raw_s or raw_s == "*":
            continue
        key = raw_s.lower()
        if key in seen:
            continue
        seen.add(key)

        # Skip pure SQL aliases produced in the same statement
        if key in stmt_aliases:
            continue

        # Determine which metadata tables own this column
        owning_tables = col_to_tables.get(key)
        if not owning_tables:
            # Not in metadata at all → handled by find_unknown_columns
            continue

        # Check whether the column has an explicit table qualifier in the SQL
        table_qualifier_raw = col_node.table
        if table_qualifier_raw and str(table_qualifier_raw).strip():
            qualifier = str(table_qualifier_raw).strip().lower()
            # If the qualifier resolves to an active table, check columns on it
            resolved = active.get(qualifier)
            if resolved is not None:
                # Column referenced as qualifier.col — verify it belongs to that table
                resolved_cols = {
                    str(c["name"]).strip().lower()
                    for c in (resolved.columns or [])
                    if c.get("name")
                }
                if key not in resolved_cols:
                    # It exists elsewhere in metadata but not on the qualified table
                    source_names = [
                        qualified_table_label(t)
                        for t in owning_tables
                        if t is not resolved
                    ]
                    if source_names:
                        misplaced.append((raw_s, source_names))
            # If qualifier is unknown (will be caught by find_unknown_tables), skip here
            continue

        # Unqualified column: check if ANY owning table is active
        active_owners = [t for t in owning_tables if active.get(t.table_name.lower()) is t]
        # Also try full qualified key matches
        if not active_owners:
            active_meta_set = set(active.values())
            active_owners = [t for t in owning_tables if t in active_meta_set]

        if not active_owners:
            source_names = list(dict.fromkeys(qualified_table_label(t) for t in owning_tables))
            misplaced.append((raw_s, source_names))

    return misplaced


def validate_generated_sql_columns(
    sql: str,
    tables: list[TableMetadata],
    sql_type: str,
) -> None:
    """Strict mode: raise QueryExecutorError if unknown columns remain."""
    unknown = find_unknown_columns(sql, tables, sql_type)
    if unknown:
        preview = ", ".join(f"'{u}'" for u in unknown[:12])
        more = f" 等共 {len(unknown)} 个" if len(unknown) > 12 else ""
        raise QueryExecutorError(
            "生成的 SQL 使用了元数据中不存在的列名（可能是臆造或拼音）："
            f"{preview}{more}。"
            "请仅使用「可用表结构」中列出的字段名；"
            "JOIN 请优先使用「关联路径参考」中的 ON 条件；"
            "需要展示别称时请使用「合法列名 AS 别名」。"
        )


def fuzzy_repair_sql_columns(
    sql: str,
    tables: list[TableMetadata],
    sql_type: str,
    cutoff: float = 0.72,
) -> tuple[str, dict[str, str]]:
    """Deterministically map hallucinated column names to the closest real metadata columns.

    Uses difflib fuzzy matching — no LLM call required.  Designed as a last-resort
    fallback when LLM-based repair rounds have already failed to eliminate unknown
    columns.

    Returns (repaired_sql, replacements) where replacements maps old_name → new_name.
    Returns (original_sql, {}) when nothing could be fixed or parsing failed.
    """
    from difflib import get_close_matches

    unknown = find_unknown_columns(sql, tables, sql_type)
    if not unknown:
        return sql, {}

    whitelist = sorted(_metadata_column_whitelist(tables))
    if not whitelist:
        return sql, {}

    dialect = _SQLGLOT_DIALECT.get(sql_type, sql_type)
    try:
        parsed = sqlglot.parse_one(sql, dialect=dialect)
    except Exception:
        return sql, {}

    aliases = _alias_names_in_statement(parsed)

    # Build replacement map: hallucinated_lower -> closest_real
    replacements: dict[str, str] = {}
    for col_name in unknown:
        if col_name.lower() in aliases:
            continue
        matches = get_close_matches(col_name.lower(), whitelist, n=1, cutoff=cutoff)
        if matches:
            replacements[col_name.lower()] = matches[0]

    if not replacements:
        return sql, {}

    # Rewrite AST column nodes in-place
    for col_node in parsed.find_all(exp.Column):
        raw = col_node.name
        if raw is None:
            continue
        key = str(raw).strip().lower()
        target = replacements.get(key)
        if target:
            col_node.set("this", exp.Identifier(this=target))

    try:
        repaired = parsed.sql(dialect=dialect)
        return repaired, {k: v for k, v in replacements.items()}
    except Exception:
        return sql, {}


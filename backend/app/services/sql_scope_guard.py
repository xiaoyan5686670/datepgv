from __future__ import annotations

from dataclasses import dataclass

import sqlglot
from sqlglot import exp

from app.services.query_executor import assert_single_read_statement
from app.services.scope_policy_service import (
    canonical_province_name,
    is_known_province_literal,
)
from app.services.scope_types import ResolvedScope

_SQLGLOT_DIALECT = {
    "postgresql": "postgres",
    "mysql": "mysql",
    "hive": "hive",
    "oracle": "oracle",
}

_PROVINCE_COLUMN_NAMES = {
    "shengfen",
    "province",
    "province_name",
    "prov",
    "renkuan",
    "省份",
    "省",
}


@dataclass
class ScopeRewriteResult:
    sql: str
    scope_applied: bool
    rewrite_note: str | None
    mentioned_disallowed_provinces: list[str]


def _norm_text(s: str | None) -> str:
    return (s or "").strip()


def _is_province_column(col: exp.Column) -> bool:
    name = _norm_text(col.name).lower()
    if not name:
        return False
    if name in _PROVINCE_COLUMN_NAMES:
        return True
    return "province" in name or "sheng" in name or "省" in name


def _extract_mentioned_provinces(parsed: exp.Expression) -> set[str]:
    out: set[str] = set()
    for node in parsed.walk():
        if isinstance(node, exp.EQ):
            left, right = node.left, node.right
            if isinstance(left, exp.Column) and isinstance(right, exp.Literal) and right.is_string:
                lit = canonical_province_name(right.this)
                if _is_province_column(left) or is_known_province_literal(lit):
                    out.add(lit)
            elif isinstance(right, exp.Column) and isinstance(left, exp.Literal) and left.is_string:
                lit = canonical_province_name(left.this)
                if _is_province_column(right) or is_known_province_literal(lit):
                    out.add(lit)
        elif isinstance(node, exp.In):
            if not isinstance(node.this, exp.Column):
                continue
            for item in node.expressions or []:
                if isinstance(item, exp.Literal) and item.is_string:
                    lit = canonical_province_name(item.this)
                    if _is_province_column(node.this) or is_known_province_literal(lit):
                        out.add(lit)
    return {v for v in out if v}


def _rewrite_province_conditions(parsed: exp.Expression, allowed: list[str]) -> bool:
    changed = False
    allowed_literals = [exp.Literal.string(v) for v in allowed]

    for node in parsed.walk():
        if isinstance(node, exp.EQ):
            left, right = node.left, node.right
            if isinstance(left, exp.Column) and isinstance(right, exp.Literal) and right.is_string:
                lit = canonical_province_name(right.this)
                if _is_province_column(left) or is_known_province_literal(lit):
                    node.replace(exp.In(this=left.copy(), expressions=allowed_literals))
                    changed = True
            elif isinstance(right, exp.Column) and isinstance(left, exp.Literal) and left.is_string:
                lit = canonical_province_name(left.this)
                if _is_province_column(right) or is_known_province_literal(lit):
                    node.replace(exp.In(this=right.copy(), expressions=allowed_literals))
                    changed = True
        elif isinstance(node, exp.In):
            target = node.this
            if not isinstance(target, exp.Column):
                continue
            has_province_literal = False
            for item in node.expressions or []:
                if isinstance(item, exp.Literal) and item.is_string:
                    lit = canonical_province_name(item.this)
                    if _is_province_column(target) or is_known_province_literal(lit):
                        has_province_literal = True
                        break
            if has_province_literal:
                node.set("expressions", allowed_literals)
                changed = True
    return changed


def rewrite_sql_with_scope(sql: str, sql_type: str, scope: ResolvedScope) -> ScopeRewriteResult:
    safe = assert_single_read_statement(sql)
    if scope.unrestricted or not scope.province_values:
        return ScopeRewriteResult(
            sql=safe,
            scope_applied=False,
            rewrite_note=None,
            mentioned_disallowed_provinces=[],
        )

    dialect = _SQLGLOT_DIALECT.get(sql_type, sql_type)
    try:
        parsed = sqlglot.parse_one(safe, dialect=dialect)
    except Exception:
        # Fall back to original SQL if parse fails; execution layer still enforces scope.
        return ScopeRewriteResult(
            sql=safe,
            scope_applied=False,
            rewrite_note="未能重写 SQL 条件，已使用执行层范围保护策略。",
            mentioned_disallowed_provinces=[],
        )

    allowed = sorted({canonical_province_name(v) for v in scope.province_values if v})
    mentioned = _extract_mentioned_provinces(parsed)
    disallowed = sorted([p for p in mentioned if p not in set(allowed)])

    changed = _rewrite_province_conditions(parsed, allowed)
    if not changed:
        return ScopeRewriteResult(
            sql=safe,
            scope_applied=False,
            rewrite_note=None,
            mentioned_disallowed_provinces=disallowed,
        )

    note = f"系统已自动应用权限范围（省份：{'、'.join(allowed)}）"
    if disallowed:
        note += f"，并替换了越权省份条件（{'、'.join(disallowed)}）"

    rewritten = parsed.sql(dialect=dialect)
    return ScopeRewriteResult(
        sql=rewritten,
        scope_applied=changed,
        rewrite_note=note,
        mentioned_disallowed_provinces=disallowed,
    )

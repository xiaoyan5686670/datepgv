from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import sqlglot
from sqlglot import exp

from app.services.query_executor import assert_single_read_statement
from app.services.province_alias_service import (
    canonical_province_name,
    is_known_province_literal,
    province_canonicals_mentioned_in_text,
    province_alias_literals_for_canonicals,
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
    "prov_name",
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
    should_block: bool
    block_reason: str | None


def _norm_text(s: str | None) -> str:
    return (s or "").strip()


def _scope_access_hint(viewer: Any | None) -> str | None:
    """按职级给出数据可见范围提示（展示在 SQL 省份改写说明中）。"""
    if viewer is None:
        return None
    el = str(getattr(viewer, "employee_level", None) or "staff").strip()
    if el == "staff":
        return "您只能查看自己的数据。"
    if el in (
        "region_executive",
        "province_executive",
        "area_executive",
        "province_manager",
        "area_manager",
    ):
        return "您只能查看辖区范围内的数据。"
    return None


def _join_scope_rewrite_lines(hint: str | None, detail: str) -> str:
    detail = detail.strip()
    if not detail:
        return (hint or "").strip()
    if hint:
        return f"{hint.strip()}\n{detail}"
    return detail


def _is_province_column(col: exp.Column) -> bool:
    name = _norm_text(col.name).lower()
    if not name:
        return False
    if name in _PROVINCE_COLUMN_NAMES:
        return True
    return "province" in name or "sheng" in name or "省" in name


def _effective_province_allowlist_for_rewrite(
    scope: ResolvedScope, viewer: Any | None
) -> set[str] | None:
    """
    None: skip province rewrite (legacy behaviour for non-staff without province scope).
    Empty set: staff with no profile province — no province literal may appear in filters.
    """
    if scope.unrestricted:
        return None
    if scope.province_values:
        return {canonical_province_name(v) for v in scope.province_values if v}
    if viewer is not None and (str(getattr(viewer, "employee_level", None) or "staff").strip() == "staff"):
        p = canonical_province_name(getattr(viewer, "province", None))
        return {p} if p else set()
    return None


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
        elif isinstance(node, exp.Like):
            if not isinstance(node.this, exp.Column):
                continue
            expr = node.expression
            if isinstance(expr, exp.Literal) and expr.is_string and _is_province_column(node.this):
                out |= province_canonicals_mentioned_in_text(expr.this)
    return {v for v in out if v}


def _rewrite_province_conditions(parsed: exp.Expression, allowed: list[str]) -> bool:
    changed = False
    allowed_literals = [exp.Literal.string(v) for v in allowed]

    for node in list(parsed.walk()):
        if isinstance(node, exp.EQ):
            left, right = node.left, node.right
            if isinstance(left, exp.Column) and isinstance(right, exp.Literal) and right.is_string:
                lit = canonical_province_name(right.this)
                if _is_province_column(left) or is_known_province_literal(lit):
                    if not allowed:
                        node.replace(exp.false())
                    else:
                        node.replace(exp.In(this=left.copy(), expressions=allowed_literals))
                    changed = True
            elif isinstance(right, exp.Column) and isinstance(left, exp.Literal) and left.is_string:
                lit = canonical_province_name(left.this)
                if _is_province_column(right) or is_known_province_literal(lit):
                    if not allowed:
                        node.replace(exp.false())
                    else:
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
                if not allowed:
                    node.replace(exp.false())
                else:
                    node.set("expressions", allowed_literals)
                changed = True
        elif isinstance(node, exp.Like):
            if not isinstance(node.this, exp.Column):
                continue
            pat_expr = node.expression
            if not isinstance(pat_expr, exp.Literal) or not pat_expr.is_string:
                continue
            if not _is_province_column(node.this):
                continue
            allow_set = set(allowed)
            if not allow_set:
                node.replace(exp.false())
                changed = True
                continue

            # Province dimension forbids LIKE: always rewrite to equality set (IN).
            # This avoids slow/fuzzy province joins and keeps behavior deterministic.
            node.replace(exp.In(this=node.this.copy(), expressions=allowed_literals))
            changed = True
    return changed


def rewrite_sql_with_scope(
    sql: str, sql_type: str, scope: ResolvedScope, viewer: Any | None = None
) -> ScopeRewriteResult:
    safe = assert_single_read_statement(sql)
    if scope.unrestricted:
        return ScopeRewriteResult(
            sql=safe,
            scope_applied=False,
            rewrite_note=None,
            mentioned_disallowed_provinces=[],
            should_block=False,
            block_reason=None,
        )

    allow = _effective_province_allowlist_for_rewrite(scope, viewer)
    if allow is None:
        return ScopeRewriteResult(
            sql=safe,
            scope_applied=False,
            rewrite_note=None,
            mentioned_disallowed_provinces=[],
            should_block=False,
            block_reason=None,
        )

    allowed = sorted(allow)
    allowed_literals = sorted(province_alias_literals_for_canonicals(set(allowed)))
    dialect = _SQLGLOT_DIALECT.get(sql_type, sql_type)
    try:
        parsed = sqlglot.parse_one(safe, dialect=dialect)
    except Exception:
        fallback = (
            "未能自动调整 SQL 中的省份条件，系统会在查询结果中按您的数据权限进行过滤。"
        )
        return ScopeRewriteResult(
            sql=safe,
            scope_applied=False,
            rewrite_note=_join_scope_rewrite_lines(_scope_access_hint(viewer), fallback),
            mentioned_disallowed_provinces=[],
            should_block=False,
            block_reason=None,
        )

    mentioned = _extract_mentioned_provinces(parsed)
    allow_set = set(allowed)
    disallowed = sorted([p for p in mentioned if p not in allow_set])
    should_block = bool(disallowed)
    block_reason = (
        f"查询包含未授权省份：{'、'.join(disallowed)}。"
        if should_block
        else None
    )

    changed = _rewrite_province_conditions(parsed, allowed_literals)
    if not changed:
        return ScopeRewriteResult(
            sql=safe,
            scope_applied=False,
            rewrite_note=None,
            mentioned_disallowed_provinces=disallowed,
            should_block=should_block,
            block_reason=block_reason,
        )

    if not allowed:
        detail = (
            "本次查询中超出权限的省份条件已自动处理；"
            "若账号未维护所属省份，将无法按省份筛选外部区域数据。"
        )
    else:
        detail = (
            f"本次查询已将省份条件改写为等值匹配（= / IN），并限定为：{'、'.join(allowed)}。"
            "为保证查询性能与准确性，系统不会在省份字段上使用 LIKE。"
        )
    if disallowed:
        detail += f" 以下未授权省份已从条件中移除：{'、'.join(disallowed)}。"

    note = _join_scope_rewrite_lines(_scope_access_hint(viewer), detail)

    rewritten = parsed.sql(dialect=dialect)
    return ScopeRewriteResult(
        sql=rewritten,
        scope_applied=changed,
        rewrite_note=note,
        mentioned_disallowed_provinces=disallowed,
        should_block=should_block,
        block_reason=block_reason,
    )

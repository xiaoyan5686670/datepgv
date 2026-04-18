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

_EMPLOYEE_NAME_COLUMN_NAMES = {
    "yewujingli",
    "full_name",
    "owner",
    "sales_name",
    "manager_name",
    "mgr_name",
    "username",
    "area_mgr_name",
    "area_mgr",
    "区域经理",
    "业务经理",
    "员工姓名",
}

_EMPLOYEE_CODE_COLUMN_NAMES = {
    "renyuanbianma",
    "employee_code",
    "owner_code",
    "sales_code",
    "manager_code",
    "user_code",
}

_REGION_COLUMN_NAMES = {
    "daqua",
    "org_region",
    "region",
    "region_name",
    "大区",
}

_DISTRICT_COLUMN_NAMES = {
    "quyud",
    "district",
    "district_name",
    "area_name",
    "区域",
}


@dataclass
class ScopeRewriteResult:
    sql: str
    scope_applied: bool
    rewrite_note: str | None
    mentioned_disallowed_provinces: list[str]
    should_block: bool
    block_reason: str | None
    is_comprehensive: bool = False  # If True, inner SQL is considered fully secured


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


def _is_employee_column(col: exp.Column) -> bool:
    name = _norm_text(col.name).lower()
    if not name:
        return False
    if name in _EMPLOYEE_NAME_COLUMN_NAMES or name in _EMPLOYEE_CODE_COLUMN_NAMES:
        return True
    return "mgr" in name or "sales" in name or "经理" in name


def _is_region_column(col: exp.Column) -> bool:
    name = _norm_text(col.name).lower()
    if not name:
        return False
    if name in _REGION_COLUMN_NAMES:
        return True
    return "region" in name or "daqu" in name or "大区" in name


def _is_district_column(col: exp.Column) -> bool:
    name = _norm_text(col.name).lower()
    if not name:
        return False
    if name in _DISTRICT_COLUMN_NAMES:
        return True
    return "district" in name or "area" in name or "quyu" in name or "区域" in name


def _resolve_column_name_from_metadata(
    table_name: str,
    tables_metadata: list[Any] | None,
    is_col_fn: callable[[exp.Column], bool],
) -> str | None:
    """Find the best matching column name for a scope dimension in a table's metadata."""
    if not tables_metadata:
        return None
    
    # Normalize table name for matching
    target_name = table_name.lower().split(".")[-1]
    
    for t in tables_metadata:
        if str(getattr(t, "table_name", "")).lower() == target_name:
            # Check columns in this table
            cols = getattr(t, "columns", []) or []
            # We look for a column that satisfies our predicate
            for c in cols:
                cname = str(c.get("name", "")).strip()
                if not cname:
                    continue
                # Create a mock Column node to use the predicate
                mock_col = exp.Column(this=exp.Identifier(this=cname, quoted=True))
                if is_col_fn(mock_col):
                    return cname
    return None


def _effective_province_allowlist_for_rewrite(
    scope: ResolvedScope, viewer: Any | None
) -> list[str] | None:
    if scope.unrestricted:
        return None
    if scope.province_values:
        return sorted({canonical_province_name(v) for v in scope.province_values if v})
    if viewer is not None and (str(getattr(viewer, "employee_level", None) or "staff").strip() == "staff"):
        p = canonical_province_name(getattr(viewer, "province", None))
        return [p] if p else []
    return None


def _effective_employee_allowlist_for_rewrite(
    scope: ResolvedScope, viewer: Any | None
) -> list[str] | None:
    if scope.unrestricted:
        return None
    
    # Base set from policies
    out = set()
    if scope.employee_values:
        out = {str(v).strip() for v in scope.employee_values if v}
        
    # Security Rule: Every user should ALWAYS be allowed to see their own data,
    # regardless of their role (manager or staff). This prevents "self-identity" loss
    # during rewriting when policies are only defined for groups.
    if viewer is not None:
        name = str(getattr(viewer, "full_name", None) or "").strip()
        code = str(getattr(viewer, "username", None) or "").strip()
        if name: out.add(name)
        if code: out.add(code)
    
    if not out:
        return None
        
    return sorted(out)


def _effective_region_allowlist_for_rewrite(
    scope: ResolvedScope, viewer: Any | None
) -> list[str] | None:
    if scope.unrestricted:
        return None
    if scope.region_values:
        return sorted({str(v).strip() for v in scope.region_values if v})
    return None


def _effective_district_allowlist_for_rewrite(
    scope: ResolvedScope, viewer: Any | None
) -> list[str] | None:
    if scope.unrestricted:
        return None
    if scope.district_values:
        return sorted({str(v).strip() for v in scope.district_values if v})
    return None


def _extract_mentioned_values(
    parsed: exp.Expression,
    is_col_fn: callable[[exp.Column], bool],
    canonical_fn: callable[[str], str] | None = None,
    is_lit_fn: callable[[str], bool] | None = None,
) -> set[str]:
    """Extract strings mentioned in SQL that seem related to a specific dimension."""
    out: set[str] = set()
    for node in parsed.walk():
        if isinstance(node, exp.EQ):
            left, right = node.left, node.right
            if isinstance(left, exp.Column) and isinstance(right, exp.Literal) and right.is_string:
                val = right.this
                if canonical_fn: val = canonical_fn(val)
                if is_col_fn(left) or (is_lit_fn and is_lit_fn(val)):
                    out.add(val)
            elif isinstance(right, exp.Column) and isinstance(left, exp.Literal) and left.is_string:
                val = left.this
                if canonical_fn: val = canonical_fn(val)
                if is_col_fn(right) or (is_lit_fn and is_lit_fn(val)):
                    out.add(val)
        elif isinstance(node, exp.In):
            if not isinstance(node.this, exp.Column):
                continue
            for item in node.expressions or []:
                if isinstance(item, exp.Literal) and item.is_string:
                    val = item.this
                    if canonical_fn: val = canonical_fn(val)
                    if is_col_fn(node.this) or (is_lit_fn and is_lit_fn(val)):
                        out.add(val)
        elif isinstance(node, exp.Like):
            if not isinstance(node.this, exp.Column):
                continue
            expr = node.expression
            if isinstance(expr, exp.Literal) and expr.is_string and is_col_fn(node.this):
                # For LIKE, we might need special handling (e.g. text extraction)
                if canonical_fn:
                    # In some contexts (like provinces), we search for names within the pattern
                    # This is mostly for 'province' dimension legacy support
                    if is_col_fn == _is_province_column:
                         out |= province_canonicals_mentioned_in_text(expr.this)
                    else:
                         val = canonical_fn(expr.this.strip("%"))
                         out.add(val)
                else:
                    out.add(expr.this.strip("%"))
    return {v for v in out if v}


def _rewrite_conditions(
    parsed: exp.Expression,
    allowed: list[str],
    is_col_fn: callable[[exp.Column], bool],
    is_lit_fn: callable[[str], bool] | None = None,
    canonical_fn: callable[[str], str] | None = None,
) -> bool:
    changed = False
    allowed_literals = [exp.Literal.string(v) for v in allowed]

    for node in list(parsed.walk()):
        if isinstance(node, exp.EQ):
            left, right = node.left, node.right
            if isinstance(left, exp.Column) and isinstance(right, exp.Literal) and right.is_string:
                val = right.this
                if canonical_fn:
                    val = canonical_fn(val)
                if is_col_fn(left) or (is_lit_fn and is_lit_fn(val)):
                    if not allowed:
                        node.replace(exp.false())
                    else:
                        node.replace(exp.In(this=left.copy(), expressions=allowed_literals))
                    changed = True
            elif isinstance(right, exp.Column) and isinstance(left, exp.Literal) and left.is_string:
                val = left.this
                if canonical_fn:
                    val = canonical_fn(val)
                if is_col_fn(right) or (is_lit_fn and is_lit_fn(val)):
                    if not allowed:
                        node.replace(exp.false())
                    else:
                        node.replace(exp.In(this=right.copy(), expressions=allowed_literals))
                    changed = True
        elif isinstance(node, exp.In):
            target = node.this
            if not isinstance(target, exp.Column):
                continue
            has_match = False
            for item in node.expressions or []:
                if isinstance(item, exp.Literal) and item.is_string:
                    val = item.this
                    if canonical_fn:
                        val = canonical_fn(val)
                    if is_col_fn(target) or (is_lit_fn and is_lit_fn(val)):
                        has_match = True
                        break
            if has_match:
                if not allowed:
                    node.replace(exp.false())
                else:
                    node.set("expressions", allowed_literals)
                changed = True
        elif isinstance(node, exp.Like):
            if not isinstance(node.this, exp.Column):
                continue
            if not is_col_fn(node.this):
                continue
            if not allowed:
                node.replace(exp.false())
            else:
                node.replace(exp.In(this=node.this.copy(), expressions=allowed_literals))
            changed = True
    return changed


def _inject_conditions(
    parsed: exp.Expression,
    allowed: list[str],
    is_col_fn: callable[[exp.Column], bool],
    default_col_name: str,
    tables_metadata: list[Any] | None = None,
) -> bool:
    """Inject WHERE filters if they are not already present in the SELECT nodes."""
    changed = False
    allowed_literals = [exp.Literal.string(v) for v in allowed]
    if not allowed_literals:
        return False

    nodes = list(parsed.find_all(exp.Select))
    if isinstance(parsed, exp.Select):
        nodes.append(parsed)
        
    for select_node in nodes:
        existing_constraint = False
        where = select_node.args.get("where")
        if where:
            for col in where.find_all(exp.Column):
                if is_col_fn(col):
                    existing_constraint = True
                    break
        
        if not existing_constraint:
            # Try to resolve the actual column name from metadata for each table in the SELECT
            table_nodes = list(select_node.find_all(exp.Table))
            resolved_col_name = None
            
            if tables_metadata and table_nodes:
                # For simplicity, if multiple tables are joined, we look for the column in all of them.
                # In most analytics queries, there's a primary fact table.
                for tn in table_nodes:
                    name = tn.name
                    resolved_col_name = _resolve_column_name_from_metadata(name, tables_metadata, is_col_fn)
                    if resolved_col_name:
                        # If the table has an alias, we should qualify the column name
                        alias = tn.alias
                        if alias:
                            resolved_col_name = f"{alias}.{resolved_col_name}"
                        break
            
            # Security-first: always fall back to the default column name if metadata lookup
            # fails. A SQL column-not-found error is a safer outcome than silently running
            # an unscoped query against all employees.
            final_col_name = resolved_col_name or default_col_name
            
            if final_col_name:
                # Inject new constraint
                new_filter = exp.In(
                    this=sqlglot.parse_one(final_col_name, into=exp.Column),
                    expressions=allowed_literals,
                )
                if where:
                    where.set("this", exp.And(this=where.this, expression=new_filter))
                else:
                    select_node.set("where", exp.Where(this=new_filter))
                changed = True
    return changed


def rewrite_sql_with_scope(
    sql: str,
    sql_type: str,
    scope: ResolvedScope,
    viewer: Any | None = None,
    tables_metadata: list[Any] | None = None,
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
            is_comprehensive=True,
        )

    dialect = _SQLGLOT_DIALECT.get(sql_type, sql_type)
    try:
        parsed = sqlglot.parse_one(safe, dialect=dialect)
    except Exception:
        fallback = "未能自动调整 SQL 条件，系统会尝试在查询结果阶段进行安全过滤。"
        return ScopeRewriteResult(
            sql=safe,
            scope_applied=False,
            rewrite_note=_join_scope_rewrite_lines(_scope_access_hint(viewer), fallback),
            mentioned_disallowed_provinces=[],
            should_block=False,
            block_reason=None,
            is_comprehensive=False,
        )

    changed = False
    details = []
    
    # 1. Provide Tracking for disallowed mentions across all dimensions
    all_disallowed: dict[str, list[str]] = {
        "province": [],
        "employee": [],
        "region": [],
        "district": []
    }

    # Helper to check and record disallowed mentions
    def _check_disallowed(dimension: str, mentioned: set[str], allowed: list[str] | None):
        if allowed is None:
            return
        allowed_set = set(allowed)
        for m in sorted(mentioned):
            if m not in allowed_set:
                all_disallowed[dimension].append(m)

    # Dimension 1: Province
    prov_allow = _effective_province_allowlist_for_rewrite(scope, viewer)
    mentioned_prov = _extract_mentioned_values(parsed, _is_province_column, canonical_fn=canonical_province_name, is_lit_fn=is_known_province_literal)
    _check_disallowed("province", mentioned_prov, prov_allow)
    prov_applied = True  # True when dimension is not restricted or restriction was injected
    if prov_allow is not None:
        prov_literals = sorted(province_alias_literals_for_canonicals(set(prov_allow)))
        c1 = _rewrite_conditions(parsed, prov_literals, _is_province_column, is_known_province_literal, canonical_province_name)
        c2 = _inject_conditions(parsed, prov_literals, _is_province_column, "province", tables_metadata)
        if c1 or c2:
            changed = True
            details.append(f"限定省份：{'、'.join(prov_allow) if prov_allow else '无'}")
        prov_applied = bool(c1 or c2)

    # Dimension 2: Employee
    emp_allow = _effective_employee_allowlist_for_rewrite(scope, viewer)
    mentioned_emp = _extract_mentioned_values(parsed, _is_employee_column)
    _check_disallowed("employee", mentioned_emp, emp_allow)
    emp_applied = True
    if emp_allow is not None:
        c1 = _rewrite_conditions(parsed, emp_allow, _is_employee_column)
        c2 = _inject_conditions(parsed, emp_allow, _is_employee_column, "sales_name", tables_metadata)
        if c1 or c2:
            changed = True
            details.append(f"限定员工：{'、'.join(emp_allow) if emp_allow else '无'}")
        emp_applied = bool(c1 or c2)

    # Dimension 3: Region
    reg_allow = _effective_region_allowlist_for_rewrite(scope, viewer)
    mentioned_reg = _extract_mentioned_values(parsed, _is_region_column)
    _check_disallowed("region", mentioned_reg, reg_allow)
    reg_applied = True
    if reg_allow is not None:
        c1 = _rewrite_conditions(parsed, reg_allow, _is_region_column)
        c2 = _inject_conditions(parsed, reg_allow, _is_region_column, "region", tables_metadata)
        if c1 or c2:
            changed = True
            details.append(f"限定大区：{'、'.join(reg_allow) if reg_allow else '无'}")
        reg_applied = bool(c1 or c2)

    # Dimension 4: District
    dist_allow = _effective_district_allowlist_for_rewrite(scope, viewer)
    mentioned_dist = _extract_mentioned_values(parsed, _is_district_column)
    _check_disallowed("district", mentioned_dist, dist_allow)
    dist_applied = True
    if dist_allow is not None:
        c1 = _rewrite_conditions(parsed, dist_allow, _is_district_column)
        c2 = _inject_conditions(parsed, dist_allow, _is_district_column, "area_name", tables_metadata)
        if c1 or c2:
            changed = True
            details.append(f"限定区域：{'、'.join(dist_allow) if dist_allow else '无'}")
        dist_applied = bool(c1 or c2)

    # Global Blocking Logic
    blocking_parts = []
    if all_disallowed["province"]:
        blocking_parts.append(f"未授权省份：{'、'.join(all_disallowed['province'])}")
    if all_disallowed["employee"]:
        blocking_parts.append(f"未授权员工：{'、'.join(all_disallowed['employee'])}")
    if all_disallowed["region"]:
        blocking_parts.append(f"未授权大区：{'、'.join(all_disallowed['region'])}")
    if all_disallowed["district"]:
        blocking_parts.append(f"未授权区域：{'、'.join(all_disallowed['district'])}")

    should_block = len(blocking_parts) > 0
    block_reason = f"查询包含未授权的信息。{'; '.join(blocking_parts)}。请调整查询范围后再试。" if should_block else None

    note = None
    if changed:
        detail_msg = f"本次查询已自动根据您的权限限定了范围（{'; '.join(details)}）。"
        note = _join_scope_rewrite_lines(_scope_access_hint(viewer), detail_msg)

    # Province restriction from scope.province_values was explicitly set by policy (e.g. area
    # managers). For staff users, _apply_staff_peer_isolated_scope clears province_values and
    # _effective_province_allowlist_for_rewrite adds a fallback from the user's profile — this is
    # a secondary defence, not the primary security gate. If that fallback injection failed (e.g.
    # the SQL already contains a province subquery the rewriter cannot touch), we must NOT let it
    # degrade comprehensiveness: the employee dimension is the real security gate for staff.
    prov_security_required = bool(scope.province_values)
    reg_security_required = bool(scope.region_values)
    dist_security_required = bool(scope.district_values)

    is_comprehensive = (
        (not prov_security_required or prov_applied)
        and emp_applied
        and (not reg_security_required or reg_applied)
        and (not dist_security_required or dist_applied)
    )

    return ScopeRewriteResult(
        sql=parsed.sql(dialect=dialect),
        scope_applied=changed,
        rewrite_note=note,
        mentioned_disallowed_provinces=all_disallowed["province"],
        should_block=should_block,
        block_reason=block_reason,
        is_comprehensive=is_comprehensive,
    )

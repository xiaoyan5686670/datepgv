"""
Build a Chinese prompt fragment describing the logged-in user's data scope for SQL generation.
Server-side only; do not accept this from the client.
"""
from __future__ import annotations

from app.models.user import User
from app.services.org_hierarchy import load_org_data, org_primary_name


def _norm(s: str | None) -> str:
    return (s or "").strip()


def build_viewer_sql_context(user: User) -> str:
    """
    Instructions for the LLM: add filters only using columns that exist in the provided schema.
    """
    role_names = {r.name for r in user.roles} if user.roles else set()
    is_admin = "admin" in role_names

    level = (user.employee_level or "staff").strip()
    full_name = _norm(user.full_name)
    username = _norm(user.username)
    org = load_org_data()
    resolved_name = org_primary_name(user, org)
    display_name = full_name or resolved_name
    province = _norm(user.province)
    district = _norm(user.district)

    lines: list[str] = []

    if is_admin:
        lines.append("- 系统角色：管理员。生成业务 SQL 时无需为「行级权限」额外添加 WHERE；执行层可能不做人员范围裁剪。")
        lines.append(f"- 账号登录名：{username or '（未设置）'}。")
        return "\n".join(lines)

    lines.append("- 下列范围由服务端根据当前登录用户注入，生成 SQL 时应尽量通过「上方表结构中已存在的字段」表达；禁止臆造列名。")
    lines.append("- 若相关维度在已检索到的表中不存在任何可对应字段，不要编造列名：可仅返回说明性注释 SQL（与系统原有规则一致）。")

    ident_parts: list[str] = []
    if display_name:
        ident_parts.append(f"姓名「{display_name}」")
    if username:
        ident_parts.append(f"登录名「{username}」")
    if ident_parts:
        lines.append("- 用户标识：" + "、".join(ident_parts) + "。")

    if level == "region_executive":
        lines.append("- 账号类型：大区总（region_executive）。")
        lines.append(
            "- 数据范围：所辖大区内全部省份；若表中有大区/省份类字段，请按用户档案中的大区、省份信息裁剪。"
        )
        if province:
            lines.append(f"- 用户档案参考省份：{province}。")
    elif level == "province_executive":
        lines.append("- 账号类型：省总（province_executive）。")
        if province:
            lines.append(
                f"- 数据范围：优先覆盖职务所辖各省；至少包含档案省份「{province}」。"
                "请用表中已有省字段表达，勿臆造列名。"
            )
        else:
            lines.append("- 数据范围：请按人员/工号及表中已有组织字段限制到该用户管辖范围。")
    elif level == "area_executive":
        lines.append("- 账号类型：区域总（area_executive）。")
        if district:
            lines.append(
                f"- 数据范围：所辖区域；档案区域参考「{district}」。"
                "仅当表中存在区域/片区类字段时再添加条件。"
            )
        else:
            lines.append("- 数据范围：所辖区域团队；请结合人员、工号与已有维度字段。")
    elif level == "province_manager":
        lines.append("- 账号类型：省区经理（province_manager）。")
        if province:
            lines.append(
                f"- 数据范围：仅本省。业务表中若存在省份/地区类字段，应对「{province}」"
                "做等值或兼容匹配（取值须与业务数据一致，勿改写省份名称）。"
            )
        else:
            lines.append("- 数据范围：省区经理账号但未配置省份，请在有人员/工号类字段时尽量限制到与当前用户相关的行。")
    elif level == "area_manager":
        lines.append("- 账号类型：区域经理（area_manager）。")
        if district:
            lines.append(
                f"- 数据范围：本人及所辖业务经理；档案区域参考「{district}」。"
                "若表中有片区/区县类字段可一并用于裁剪。"
            )
        else:
            lines.append("- 数据范围：本人及直接下级（业务经理）；请用工号、姓名字段表达。")
    elif level == "staff":
        lines.append("- 账号类型：普通员工（staff）。")
        if district:
            lines.append(
                f"- 数据范围：优先限制到本人或本区县「{district}」相关数据；"
                "仅当表中存在区县、人员、工号等字段时再添加条件。"
            )
        else:
            lines.append(
                "- 数据范围：优先限制到与当前用户本人（姓名或工号类字段）相关的数据；"
                "仅当表中存在对应字段时再添加条件。"
            )
    else:
        lines.append(f"- 账号类型：{level}。")
        if province:
            lines.append(f"- 若表中有省份类字段，可优先限制到「{province}」。")
        if district:
            lines.append(f"- 若表中有区县类字段，可优先限制到「{district}」。")

    return "\n".join(lines)

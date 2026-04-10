from __future__ import annotations

import csv
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.models.user import User

CSV_PATH = Path(__file__).resolve().parents[3] / "业务经理通讯录.csv"
INVALID_TOKENS = {"", "/", "-", "无", "null", "none", "nan"}

# 数值越大权限层级越高（同步合并时取较高）。
# 正确业务层级（从高到低）：
#   大区总 > 省总 > 省区经理（zhiwu 省级但非省总）> 区域总 > 区域经理 > 基层
EMPLOYEE_LEVEL_RANK: dict[str, int] = {
    "region_executive": 60,   # 大区总
    "province_executive": 50, # 省总（shengzong 列）
    "province_manager": 45,   # 省区经理（zhiwu，非 shengzong）
    "area_executive": 40,     # 区域总（quyuzong 列）
    "area_manager": 20,       # 区域经理（zhiwu，非 quyuzong）
    "staff": 10,
}

# 不是真实人名的领导列垃圾值（超出 INVALID_TOKENS 的补充）
_GARBAGE_NAMES: frozenset[str] = frozenset({"测试", "、"})
_EMPLOYEE_CODE_RE = re.compile(r"^XY\d+$", re.IGNORECASE)


def _is_valid_person_name(s: str) -> bool:
    """判断字符串是否像真实人名（过滤数字、工号、垃圾值）。"""
    if not s or len(s) < 2:
        return False
    if s.isdigit():
        return False
    if _EMPLOYEE_CODE_RE.match(s):
        return False
    if s in _GARBAGE_NAMES:
        return False
    return True


def _split_leader_names(raw: str) -> list[str]:
    """
    把领导列中斜杠分隔的多人值拆分为独立姓名列表。
    例：「崔露露/何宾」→ ['崔露露', '何宾']
    """
    parts = [p.strip() for p in raw.split("/") if p.strip()]
    return [p for p in parts if _is_valid_person_name(p)]


@dataclass
class OrgData:
    rows: list[dict[str, str]]
    edges: list[dict[str, str]]
    nodes: dict[str, dict[str, Any]]
    by_name_codes: dict[str, set[str]]
    by_role_names: dict[str, set[str]]


def _norm(value: Any) -> str:
    text = str(value or "").strip()
    return "" if text.lower() in INVALID_TOKENS else text


def org_text(value: Any) -> str:
    """Normalize text for comparing user profile fields with 通讯录."""
    return _norm(value)


def _pick(row: dict[str, str], *keys: str) -> str:
    for key in keys:
        val = _norm(row.get(key))
        if val:
            return val
    return ""


def _read_csv_rows() -> list[dict[str, str]]:
    if not CSV_PATH.exists():
        return []
    for enc in ("utf-8-sig", "utf-8", "gb18030"):
        try:
            with CSV_PATH.open("r", encoding=enc, newline="") as f:
                return list(csv.DictReader(f))
        except UnicodeDecodeError:
            continue
    return []


def _build_org() -> OrgData:
    rows = _read_csv_rows()
    edges: list[dict[str, str]] = []
    nodes: dict[str, dict[str, Any]] = {}
    by_name_codes: dict[str, set[str]] = {}
    by_role_names: dict[str, set[str]] = {
        "daquzong": set(),
        "shengzong": set(),
        "quyuzong": set(),
        "yewujingli": set(),
    }

    for raw in rows:
        region = _pick(raw, "daqua")
        province = _pick(raw, "shengfen")
        district = _pick(raw, "quyud")
        code = _pick(raw, "renyuanbianma")
        manager = _pick(raw, "yewujingli")
        title = _pick(raw, "zhiwu")

        # 领导列支持斜杠分隔多人（如「崔露露/何宾」），并过滤垃圾值
        daquzong_names = _split_leader_names(_pick(raw, "daquzong"))
        shengzong_names = _split_leader_names(_pick(raw, "shengzong"))
        quyuzong_names  = _split_leader_names(_pick(raw, "quyuzong"))
        # 取第一个有效名字用于边关系（多人共担时取首位）
        daquzong = daquzong_names[0] if daquzong_names else ""
        shengzong = shengzong_names[0] if shengzong_names else ""
        quyuzong  = quyuzong_names[0]  if quyuzong_names  else ""

        if code and manager:
            by_name_codes.setdefault(manager, set()).add(code)

        for role, names in (
            ("daquzong", daquzong_names),
            ("shengzong", shengzong_names),
            ("quyuzong", quyuzong_names),
            ("yewujingli", [manager] if manager else []),
        ):
            for name in names:
                by_role_names[role].add(name)

        if manager:
            nodes.setdefault(
                manager,
                {
                    "name": manager,
                    "employee_code": code or None,
                    "title": title or None,
                    "region": region or None,
                    "province": province or None,
                    "district": district or None,
                },
            )
        if code and manager and not nodes[manager].get("employee_code"):
            nodes[manager]["employee_code"] = code

        def add_edge(parent: str, child: str, rel: str) -> None:
            if not parent or not child or parent == child:
                return
            edges.append({"from": parent, "to": child, "relation": rel})
            nodes.setdefault(parent, {"name": parent})
            nodes.setdefault(child, {"name": child})

        add_edge(daquzong, shengzong, "daquzong_to_shengzong")
        add_edge(shengzong, quyuzong, "shengzong_to_quyuzong")
        add_edge(quyuzong, manager, "quyuzong_to_manager")

    return OrgData(
        rows=rows,
        edges=edges,
        nodes=nodes,
        by_name_codes=by_name_codes,
        by_role_names=by_role_names,
    )


@lru_cache(maxsize=1)
def _cached_org(_: int) -> OrgData:
    return _build_org()


def load_org_data() -> OrgData:
    mtime = int(CSV_PATH.stat().st_mtime) if CSV_PATH.exists() else 0
    return _cached_org(mtime)


def _remove_cycle_edges(edges: list[dict[str, str]]) -> list[dict[str, str]]:
    """
    Iterative DFS that identifies back-edges (edges that close a cycle) and
    removes them so the returned edge list forms a DAG.
    """
    adj: dict[str, list[str]] = {}
    for e in edges:
        adj.setdefault(e["from"], []).append(e["to"])

    visited: set[str] = set()
    in_stack: set[str] = set()
    back_edges: set[tuple[str, str]] = set()

    for start in list(adj.keys()):
        if start in visited:
            continue
        visited.add(start)
        in_stack.add(start)
        # Stack holds (node, iterator-over-children)
        stack: list[tuple[str, Any]] = [(start, iter(adj.get(start, [])))]
        while stack:
            node, children = stack[-1]
            try:
                child = next(children)
                if child in in_stack:
                    back_edges.add((node, child))
                elif child not in visited:
                    visited.add(child)
                    in_stack.add(child)
                    stack.append((child, iter(adj.get(child, []))))
            except StopIteration:
                stack.pop()
                in_stack.discard(node)

    return [e for e in edges if (e["from"], e["to"]) not in back_edges]


def get_org_graph_payload() -> dict[str, Any]:
    org = load_org_data()
    acyclic_edges = _remove_cycle_edges(org.edges)
    return {
        "source_csv": str(CSV_PATH),
        "node_count": len(org.nodes),
        "edge_count": len(acyclic_edges),
        "nodes": list(org.nodes.values()),
        "edges": acyclic_edges,
    }


def merge_employee_level(current: str, new: str) -> str:
    ra = EMPLOYEE_LEVEL_RANK.get(current, 0)
    rb = EMPLOYEE_LEVEL_RANK.get(new, 0)
    return new if rb > ra else current


def org_self_row_yewujingli(username: str, org: OrgData) -> str:
    """
    登录账号常为人员编码。通讯录中该编码所在行的 yewujingli 即业务姓名（如大区总本人）。
    若多行同编码，优先取该行姓名与 shengzong/daquzong/quyuzong 之一相同的那条（本人档案行）。
    """
    un = _norm(username)
    if not un:
        return ""
    fallback = ""
    for r in org.rows:
        if _pick(r, "renyuanbianma") != un:
            continue
        yj = _pick(r, "yewujingli")
        if not yj:
            continue
        if yj == _pick(r, "shengzong") or yj == _pick(r, "daquzong") or yj == _pick(r, "quyuzong"):
            return yj
        if not fallback:
            fallback = yj
    return fallback


def org_identity_names(user: User, org: OrgData) -> list[str]:
    """用于权限匹配：档案姓名、通讯录按工号解析的姓名、登录名（去重保序）。"""
    seen: set[str] = set()
    out: list[str] = []

    def add(s: str) -> None:
        if s and s not in seen:
            seen.add(s)
            out.append(s)

    add(_norm(user.full_name))
    add(org_self_row_yewujingli(user.username, org))
    add(_norm(user.username))
    return out


def org_primary_name(user: User, org: OrgData) -> str:
    """列表权限、省区范围等用的主组织姓名（优先工号行解析）。"""
    yj = org_self_row_yewujingli(user.username, org)
    if yj:
        return yj
    fn = _norm(user.full_name)
    if fn:
        return fn
    return _norm(user.username)


def infer_employee_level_for_name(name: str, org: OrgData) -> str:
    """
    按通讯录推断层级，领导列优先（daquzong > shengzong > quyuzong），
    然后按 zhiwu 关键词推断（大区经理→region_executive，省区*→province_manager，
    区域经理→area_executive，其余→staff）。
    """
    if not _norm(name):
        return "staff"
    if name in org.by_role_names["daquzong"]:
        return "region_executive"
    if name in org.by_role_names["shengzong"]:
        return "province_executive"
    if name in org.by_role_names["quyuzong"]:
        return "area_executive"
    titles = {_pick(r, "zhiwu") for r in org.rows if _pick(r, "yewujingli") == name}
    for t in titles:
        if t and "大区经理" in t:
            return "region_executive"
    for t in titles:
        if t and "省区" in t:
            return "province_manager"
    for t in titles:
        if t and "区域经理" in t:
            return "area_manager"
    return "staff"


def _name_matches_field(name: str, raw_field: str) -> bool:
    """Check if *name* is one of the (possibly slash-separated) values in *raw_field*."""
    return name in _split_leader_names(raw_field)


def _scope_from_leader_column(org: OrgData, col: str, leader_name: str) -> set[str]:
    out: set[str] = {leader_name}
    for r in org.rows:
        if not _name_matches_field(leader_name, _pick(r, col)):
            continue
        for key in ("renyuanbianma", "yewujingli"):
            v = _pick(r, key)
            if v:
                out.add(v)
    return out


def _area_manager_scope(org: OrgData, manager_name: str, own_codes: set[str]) -> set[str]:
    out = set(own_codes)
    if manager_name:
        out.add(manager_name)
        out |= org.by_name_codes.get(manager_name, set())
    for r in org.rows:
        if _pick(r, "yewujingli") == manager_name:
            for key in ("renyuanbianma", "yewujingli"):
                v = _pick(r, key)
                if v:
                    out.add(v)
    return out


def provinces_for_region_executive(full_name: str, org: OrgData) -> set[str]:
    regions = {
        _pick(r, "daqua")
        for r in org.rows
        if _name_matches_field(full_name, _pick(r, "daquzong")) and _pick(r, "daqua")
    }
    if not regions:
        return set()
    return {
        _pick(r, "shengfen")
        for r in org.rows
        if _pick(r, "daqua") in regions and _pick(r, "shengfen")
    }


def provinces_for_province_executive(full_name: str, org: OrgData) -> set[str]:
    return {
        _pick(r, "shengfen")
        for r in org.rows
        if _name_matches_field(full_name, _pick(r, "shengzong")) and _pick(r, "shengfen")
    }


def province_district_pairs_for_area_executive(full_name: str, org: OrgData) -> list[tuple[str, str]]:
    pairs: list[tuple[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for r in org.rows:
        if not _name_matches_field(full_name, _pick(r, "quyuzong")):
            continue
        p, d = _pick(r, "shengfen"), _pick(r, "quyud")
        if not p:
            continue
        key = (p, d)
        if key not in seen:
            seen.add(key)
            pairs.append(key)
    return pairs


def management_can_view_user(viewer: User, target: User, org: OrgData) -> bool:
    """Whether viewer may open target user in /users (non-admin)."""
    if viewer.id == target.id:
        return True
    role_names = {r.name for r in viewer.roles} if viewer.roles else set()
    if "admin" in role_names:
        return True
    primary = org_primary_name(viewer, org)
    el = (viewer.employee_level or "staff").strip()
    if el in ("staff", "area_manager"):
        return False
    tp, td = _norm(target.province), _norm(target.district)
    if el == "province_manager":
        vp = _norm(viewer.province)
        return bool(vp and tp == vp)
    if el == "region_executive":
        provs = provinces_for_region_executive(primary, org)
        return bool(tp and tp in provs)
    if el == "province_executive":
        provs = provinces_for_province_executive(primary, org)
        return bool(tp and tp in provs)
    if el == "area_executive":
        for p, d in province_district_pairs_for_area_executive(primary, org):
            if tp != p:
                continue
            if not d or d == td:
                return True
        return False
    return False


def get_user_scope_codes(user: User) -> set[str] | None:
    """
    Return visible employee codes for the current user.
    None means unrestricted (admin).
    """
    role_names = {r.name for r in user.roles} if user.roles else set()
    if "admin" in role_names:
        return None

    org = load_org_data()
    aliases = org_identity_names(user, org)
    own_codes: set[str] = set()
    for key in aliases:
        own_codes.add(key)
        own_codes |= org.by_name_codes.get(key, set())

    # 1) CSV 领导列：大区总 / 省总 / 区域总（支持用工号登录：从通讯录反查 yewujingli）
    for n in aliases:
        if not n:
            continue
        if n in org.by_role_names["daquzong"]:
            return _scope_from_leader_column(org, "daquzong", n) | own_codes
    for n in aliases:
        if n in org.by_role_names["shengzong"]:
            return _scope_from_leader_column(org, "shengzong", n) | own_codes
    for n in aliases:
        if n in org.by_role_names["quyuzong"]:
            return _scope_from_leader_column(org, "quyuzong", n) | own_codes

    el = (user.employee_level or "staff").strip()

    # 1b) 档案等级与通讯录一致但姓名未写入用户表：按等级扩 scope
    primary = org_primary_name(user, org)
    if el == "region_executive" and primary in org.by_role_names["daquzong"]:
        return _scope_from_leader_column(org, "daquzong", primary) | own_codes
    if el == "province_executive" and primary in org.by_role_names["shengzong"]:
        return _scope_from_leader_column(org, "shengzong", primary) | own_codes
    if el == "area_executive" and primary in org.by_role_names["quyuzong"]:
        return _scope_from_leader_column(org, "quyuzong", primary) | own_codes

    # 2) 省区经理（职务 zhiwu 推断同步）：本省通讯录内人员
    if el == "province_manager" and _norm(user.province):
        pv = _norm(user.province)
        province_codes = {
            _pick(r, "renyuanbianma")
            for r in org.rows
            if _pick(r, "shengfen") == pv and _pick(r, "renyuanbianma")
        }
        province_names = {
            _pick(r, "yewujingli")
            for r in org.rows
            if _pick(r, "shengfen") == pv and _pick(r, "yewujingli")
        }
        return province_codes | province_names | own_codes

    # 3) 区域经理：本人 + 名下业务经理行
    mgr = primary if el == "area_manager" else ""
    if el == "area_manager" and mgr:
        return _area_manager_scope(org, mgr, own_codes)

    return own_codes


def _match_scope_value(value: Any, scope_codes: set[str]) -> bool:
    if value is None:
        return False
    text = _norm(value)
    if not text:
        return False
    return text in scope_codes


def filter_rows_by_scope(rows: list[dict[str, Any]], scope_codes: set[str] | None) -> list[dict[str, Any]]:
    if scope_codes is None:
        return rows
    if not scope_codes:
        return []

    code_columns = (
        "renyuanbianma",
        "employee_code",
        "owner_code",
        "sales_code",
        "manager_code",
        "user_code",
    )
    name_columns = ("yewujingli", "full_name", "owner", "sales_name", "manager_name", "username")

    filtered: list[dict[str, Any]] = []
    for row in rows:
        hit = any(_match_scope_value(row.get(c), scope_codes) for c in code_columns)
        if not hit:
            hit = any(_match_scope_value(row.get(c), scope_codes) for c in name_columns)
        if hit:
            filtered.append(row)
    return filtered

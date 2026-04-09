from __future__ import annotations

import csv
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.models.user import User

CSV_PATH = Path(__file__).resolve().parents[3] / "业务经理通讯录.csv"
INVALID_TOKENS = {"", "/", "-", "无", "null", "none", "nan"}


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
        daquzong = _pick(raw, "daquzong")
        shengzong = _pick(raw, "shengzong")
        quyuzong = _pick(raw, "quyuzong")
        title = _pick(raw, "zhiwu")

        if code and manager:
            by_name_codes.setdefault(manager, set()).add(code)

        for role, name in (
            ("daquzong", daquzong),
            ("shengzong", shengzong),
            ("quyuzong", quyuzong),
            ("yewujingli", manager),
        ):
            if name:
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


def get_org_graph_payload() -> dict[str, Any]:
    org = load_org_data()
    return {
        "source_csv": str(CSV_PATH),
        "node_count": len(org.nodes),
        "edge_count": len(org.edges),
        "nodes": list(org.nodes.values()),
        "edges": org.edges,
    }


def get_user_scope_codes(user: User) -> set[str] | None:
    """
    Return visible employee codes for the current user.
    None means unrestricted (admin).
    """
    role_names = {r.name for r in user.roles} if user.roles else set()
    if "admin" in role_names:
        return None

    org = load_org_data()
    full_name = _norm(user.full_name)
    username = _norm(user.username)

    own_codes: set[str] = set()
    if full_name:
        own_codes |= org.by_name_codes.get(full_name, set())
        own_codes.add(full_name)
    if username:
        own_codes.add(username)

    # Priority: explicit org hierarchy role in CSV.
    for role_col in ("daquzong", "shengzong", "quyuzong"):
        if full_name and full_name in org.by_role_names[role_col]:
            downstream = {
                _pick(r, "renyuanbianma")
                for r in org.rows
                if _pick(r, role_col) == full_name and _pick(r, "renyuanbianma")
            }
            downstream_names = {
                _pick(r, "yewujingli")
                for r in org.rows
                if _pick(r, role_col) == full_name and _pick(r, "yewujingli")
            }
            return downstream | downstream_names | own_codes

    # Fallback for province-level account model in current system.
    if user.employee_level == "province_manager" and user.province:
        province_codes = {
            _pick(r, "renyuanbianma")
            for r in org.rows
            if _pick(r, "shengfen") == _norm(user.province) and _pick(r, "renyuanbianma")
        }
        province_names = {
            _pick(r, "yewujingli")
            for r in org.rows
            if _pick(r, "shengfen") == _norm(user.province) and _pick(r, "yewujingli")
        }
        return province_codes | province_names | own_codes

    # Regular manager/staff: self only.
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

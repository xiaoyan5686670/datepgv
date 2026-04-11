"""
Compute ABAC hierarchy_path prefixes for hierarchical RAG (DB-side @> filter).
"""
from __future__ import annotations

from typing import Any

from app.models.rag_abac import UserPermission
from app.models.user import User
from app.services.org_hierarchy import (
    load_org_data,
    org_identity_names,
    org_primary_name,
    org_text,
    province_district_pairs_for_area_executive,
    provinces_for_province_executive,
    provinces_for_region_executive,
    _name_matches_field,
    _norm,
    _pick,
)


def _dedupe_prefixes(prefixes: list[list[str]]) -> list[list[str]]:
    seen: set[tuple[str, ...]] = set()
    out: list[list[str]] = []
    for parts in prefixes:
        seq = tuple(_norm(x) for x in parts if _norm(x))
        if not seq or seq in seen:
            continue
        seen.add(seq)
        out.append(list(seq))
    return out


def _append_prefix(out: list[list[str]], parts: list[str]) -> None:
    seq = [_norm(x) for x in parts if _norm(x)]
    if seq:
        out.append(seq)


def _build_rag_attributes(user: User) -> dict[str, object]:
    return {
        "employee_level": user.employee_level,
        "org_region": user.org_region,
        "province": user.province,
        "district": user.district,
        "full_name": user.full_name,
        "username": user.username,
    }


def _normalize_override_prefixes(raw: Any) -> list[list[str]]:
    if not isinstance(raw, list):
        return []
    out: list[list[str]] = []
    for item in raw:
        if isinstance(item, (list, tuple)):
            row = [str(x).strip() for x in item if str(x).strip()]
            if row:
                out.append(row)
    return out


def _permission_from_org_csv(user: User, attrs: dict[str, object]) -> UserPermission:
    """Derive prefixes from 通讯录 + 用户档案（不含 admin / 库覆盖）。"""
    org = load_org_data()
    aliases = org_identity_names(user, org)
    primary = org_primary_name(user, org)
    el = (user.employee_level or "staff").strip()
    prefixes: list[list[str]] = []

    for n in aliases:
        if not n:
            continue
        if n in org.by_role_names["daquzong"]:
            for r in org.rows:
                if not _name_matches_field(n, _pick(r, "daquzong")):
                    continue
                daq = _pick(r, "daqua")
                if daq:
                    _append_prefix(prefixes, [daq])
            break
    else:
        for n in aliases:
            if not n:
                continue
            if n in org.by_role_names["shengzong"]:
                for r in org.rows:
                    if not _name_matches_field(n, _pick(r, "shengzong")):
                        continue
                    daq, prov = _pick(r, "daqua"), _pick(r, "shengfen")
                    if daq and prov:
                        _append_prefix(prefixes, [daq, prov])
                break
        else:
            for n in aliases:
                if not n:
                    continue
                if n in org.by_role_names["quyuzong"]:
                    for r in org.rows:
                        if not _name_matches_field(n, _pick(r, "quyuzong")):
                            continue
                        daq, prov, dist = (
                            _pick(r, "daqua"),
                            _pick(r, "shengfen"),
                            _pick(r, "quyud"),
                        )
                        if daq and prov:
                            _append_prefix(
                                prefixes,
                                [daq, prov, dist] if dist else [daq, prov],
                            )
                    break
            else:
                if el == "region_executive" and primary in org.by_role_names["daquzong"]:
                    for r in org.rows:
                        if not _name_matches_field(primary, _pick(r, "daquzong")):
                            continue
                        daq = _pick(r, "daqua")
                        if daq:
                            _append_prefix(prefixes, [daq])
                elif el == "province_executive" and primary in org.by_role_names["shengzong"]:
                    for r in org.rows:
                        if not _name_matches_field(primary, _pick(r, "shengzong")):
                            continue
                        daq, prov = _pick(r, "daqua"), _pick(r, "shengfen")
                        if daq and prov:
                            _append_prefix(prefixes, [daq, prov])
                elif el == "area_executive" and primary in org.by_role_names["quyuzong"]:
                    for r in org.rows:
                        if not _name_matches_field(primary, _pick(r, "quyuzong")):
                            continue
                        daq, prov, dist = (
                            _pick(r, "daqua"),
                            _pick(r, "shengfen"),
                            _pick(r, "quyud"),
                        )
                        if daq and prov:
                            _append_prefix(
                                prefixes,
                                [daq, prov, dist] if dist else [daq, prov],
                            )

    if not prefixes and el == "province_manager" and org_text(user.province):
        pv = org_text(user.province)
        for r in org.rows:
            if _pick(r, "shengfen") != pv:
                continue
            daq = _pick(r, "daqua")
            if daq:
                _append_prefix(prefixes, [daq, pv])

    if not prefixes and el == "area_manager" and primary:
        for r in org.rows:
            if _pick(r, "yewujingli") != primary:
                continue
            daq, prov, dist, yj = (
                _pick(r, "daqua"),
                _pick(r, "shengfen"),
                _pick(r, "quyud"),
                _pick(r, "yewujingli"),
            )
            if daq and prov:
                _append_prefix(
                    prefixes,
                    [daq, prov, dist, yj] if dist else [daq, prov, yj],
                )

    if not prefixes and el == "region_executive" and primary:
        for prov in sorted(provinces_for_region_executive(primary, org)):
            daqs = {
                _pick(r, "daqua")
                for r in org.rows
                if _pick(r, "shengfen") == prov and _pick(r, "daqua")
            }
            for daq in sorted(daqs):
                _append_prefix(prefixes, [daq, prov])

    if not prefixes and el == "province_executive" and primary:
        for prov in sorted(provinces_for_province_executive(primary, org)):
            daqs = {
                _pick(r, "daqua")
                for r in org.rows
                if _pick(r, "shengfen") == prov and _pick(r, "daqua")
            }
            for daq in sorted(daqs):
                _append_prefix(prefixes, [daq, prov])

    if not prefixes and el == "area_executive" and primary:
        for p, d in province_district_pairs_for_area_executive(primary, org):
            daqs = {
                _pick(r, "daqua")
                for r in org.rows
                if _pick(r, "shengfen") == p
                and _pick(r, "daqua")
                and (not d or _pick(r, "quyud") == d)
            }
            for daq in sorted(daqs):
                _append_prefix(prefixes, [daq, p, d] if d else [daq, p])

    if not prefixes:
        un = _norm(user.username)
        for r in org.rows:
            if _pick(r, "yewujingli") != primary and _pick(r, "renyuanbianma") != un:
                continue
            daq, prov, dist, yj = (
                _pick(r, "daqua"),
                _pick(r, "shengfen"),
                _pick(r, "quyud"),
                _pick(r, "yewujingli"),
            )
            if daq and prov and yj:
                _append_prefix(
                    prefixes,
                    [daq, prov, dist, yj] if dist else [daq, prov, yj],
                )

    if not prefixes:
        oq, op, od = org_text(user.org_region), org_text(user.province), org_text(user.district)
        fn = org_text(user.full_name)
        if oq and op and od:
            _append_prefix(prefixes, [oq, op, od])
        elif oq and op:
            _append_prefix(prefixes, [oq, op])
        elif oq and fn:
            _append_prefix(prefixes, [oq, fn])
        elif op and fn:
            _append_prefix(prefixes, [op, fn])
        elif oq:
            _append_prefix(prefixes, [oq])
        elif op:
            _append_prefix(prefixes, [op])

    uniq = _dedupe_prefixes(prefixes)
    first = uniq[0] if uniq else None
    return UserPermission(
        unrestricted=False,
        allowed_prefix=first,
        allowed_prefixes=uniq,
        attributes=attrs,
    )


def compute_rag_org_baseline_permission(user: User) -> UserPermission:
    """
    仅按通讯录/档案推导的 RAG 前缀（不用库中 rag_permission_override）。
    用于管理员对照「自动规则」与「生效规则」。
    """
    attrs = _build_rag_attributes(user)
    return _permission_from_org_csv(user, attrs)


def _permission_from_override(
    ov: dict[str, Any], attrs: dict[str, object]
) -> UserPermission | None:
    if ov.get("unrestricted") is True:
        return UserPermission(
            unrestricted=True,
            allowed_prefix=None,
            allowed_prefixes=[],
            attributes=attrs,
        )
    if "prefixes" in ov:
        uniq = _dedupe_prefixes(_normalize_override_prefixes(ov.get("prefixes")))
        first = uniq[0] if uniq else None
        return UserPermission(
            unrestricted=False,
            allowed_prefix=first,
            allowed_prefixes=uniq,
            attributes=attrs,
        )
    return None


def compute_rag_user_permission(user: User) -> UserPermission:
    """
    Derive allowed hierarchy_path prefixes (JSONB array segments).

    Documents are visible when ``chunk.hierarchy_path @> prefix`` for any prefix
    (prefix is user's position in the org tree; longer chunk paths are descendants).
    """
    role_names = {r.name for r in user.roles} if user.roles else set()
    attrs = _build_rag_attributes(user)
    if "admin" in role_names:
        return UserPermission(
            unrestricted=True,
            allowed_prefix=None,
            allowed_prefixes=[],
            attributes=attrs,
        )

    ov = getattr(user, "rag_permission_override", None)
    if isinstance(ov, dict) and ov:
        forced = _permission_from_override(ov, attrs)
        if forced is not None:
            return forced

    return _permission_from_org_csv(user, attrs)
